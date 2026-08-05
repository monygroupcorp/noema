// native-test — end-to-end verification of the tee SOCKS5+WS+GostUDPTun+WireGuard stack
// without a browser. Runs the same code path as the browser WASM.
//
// Usage (from repo root):
//
//	go run ./tee/native-test/
//
// What it does:
//  1. Generates server + client WireGuard keypairs
//  2. Starts tee-wg-server as a subprocess on localhost:8080
//  3. Connects via socksgo SOCKS5+WS+GostUDPTun (same path as browser WASM)
//  4. Brings up a WireGuard device over the tunnel
//  5. Sends a test UDP packet and verifies the WG handshake appears in server logs
//  6. Tears down and reports result
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	conn "github.com/asciimoth/batchudp"
	"github.com/asciimoth/gonnect"
	"github.com/asciimoth/gonnect-netstack/vtun"
	"github.com/asciimoth/socksgo"
	"github.com/asciimoth/wgo/device"
	"golang.org/x/crypto/curve25519"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("FAIL: %v", err)
	}
	fmt.Println("PASS")
}

func run() error {
	// ── 1. Generate keypairs ──────────────────────────────────────────────────

	serverPriv, serverPub, err := genKeyPair()
	if err != nil {
		return fmt.Errorf("server keygen: %w", err)
	}
	clientPriv, clientPub, err := genKeyPair()
	if err != nil {
		return fmt.Errorf("client keygen: %w", err)
	}

	log.Printf("server pubkey: %s", b64(serverPub[:]))
	log.Printf("client pubkey: %s", b64(clientPub[:]))

	// ── 2. Start tee-wg-server as a subprocess ────────────────────────────────

	logFile, err := os.CreateTemp("", "wg-server-*.log")
	if err != nil {
		return fmt.Errorf("create log file: %w", err)
	}
	defer os.Remove(logFile.Name())
	defer logFile.Close()

	// Use non-standard ports to avoid conflicts with other WG or SOCKS instances.
	const wgPort = 15182
	const socksAddr = "127.0.0.1:18088"
	const wgPeerEndpoint = "127.0.0.1:15182"

	serverEnv := append(os.Environ(),
		"WG_PRIVATE_KEY="+b64(serverPriv[:]),
		"WG_CLIENT_PUBKEY="+b64(clientPub[:]),
		"WG_TUNNEL_IP=10.77.0.1",
		"WG_PEER_IP=10.77.0.2",
		fmt.Sprintf("WG_LISTEN_PORT=%d", wgPort),
		"SOCKS_ADDR="+socksAddr,
		"RUNNER_UPSTREAM=http://127.0.0.1:19998",
	)
	// Build the server binary first.
	buildCmd := exec.Command("go", "build", "-o", "/tmp/tee-wg-server-test", ".")
	buildCmd.Dir = repoRoot() + "/tee/wg-server"
	buildCmd.Stdout = os.Stdout
	buildCmd.Stderr = os.Stderr
	if err := buildCmd.Run(); err != nil {
		return fmt.Errorf("build server: %w", err)
	}

	serverCmd := exec.Command("/tmp/tee-wg-server-test")
	serverCmd.Env = serverEnv
	serverCmd.Stdout = io.MultiWriter(os.Stdout, logFile)
	serverCmd.Stderr = io.MultiWriter(os.Stderr, logFile)
	if err := serverCmd.Start(); err != nil {
		return fmt.Errorf("start server: %w", err)
	}
	defer func() {
		_ = serverCmd.Process.Kill()
		_ = serverCmd.Wait()
		os.Remove("/tmp/tee-wg-server-test")
	}()

	// Wait for server to be ready: poll /health until it responds 200.
	healthURL := "http://" + socksAddr + "/health"
	log.Printf("server started (pid=%d) — polling %s", serverCmd.Process.Pid, healthURL)
	deadline := time.Now().Add(15 * time.Second)
	for {
		if time.Now().After(deadline) {
			return fmt.Errorf("server did not become healthy within 15s")
		}
		resp, err := http.Get(healthURL) //nolint
		if err == nil && resp.StatusCode == 200 {
			_ = resp.Body.Close()
			log.Printf("server is healthy")
			break
		}
		if resp != nil {
			_ = resp.Body.Close()
		}
		time.Sleep(250 * time.Millisecond)
	}

	// ── 3. Connect via socksgo SOCKS5+WS+GostUDPTun ──────────────────────────

	proxyURL := "socks5+ws://" + socksAddr + "/?gost&insecureudp"
	socksClient, err := socksgo.ClientFromURL(proxyURL)
	if err != nil {
		return fmt.Errorf("build socks client: %w", err)
	}
	socksClient.Filter = nil
	// Belt-and-suspenders: also set fields directly (matches browser WASM code).
	socksClient.GostUDPTun = true
	socksClient.InsecureUDP = true
	log.Printf("socks client: GostUDPTun=%v InsecureUDP=%v IsTLS=%v IsUDPAllowed=%v WebSocketURL=%q",
		socksClient.GostUDPTun, socksClient.InsecureUDP, socksClient.IsTLS(),
		socksClient.IsUDPAllowed(), socksClient.WebSocketURL)

	network := &singleStackUDPNetwork{Network: socksClient}

	// ── 4. Bring up WireGuard device ─────────────────────────────────────────

	localAddr := netip.MustParseAddr("10.77.0.2")
	vt, err := (&vtun.Opts{
		LocalAddrs:     []netip.Addr{localAddr},
		NoLoopbackAddr: true,
		Name:           "test-wg",
	}).Build()
	if err != nil {
		return fmt.Errorf("build vtun: %w", err)
	}
	defer vt.Close()

	select {
	case ev := <-vt.Events():
		log.Printf("vtun ready event=%d", ev)
	case <-time.After(5 * time.Second):
		return fmt.Errorf("vtun ready timeout")
	}

	dev := device.NewDevice(vt, conn.NewDefaultBind(network), device.NewLogger(device.LogLevelDebug, "[client-wg] "))
	defer dev.Close()

	if err := dev.SetPrivateKey(device.NoisePrivateKey(clientPriv)); err != nil {
		return fmt.Errorf("set private key: %w", err)
	}
	if err := dev.SetListenPort(0); err != nil {
		return fmt.Errorf("set listen port: %w", err)
	}

	peerPub := device.NoisePublicKey(serverPub)
	if _, err := dev.NewPeer(peerPub); err != nil {
		return fmt.Errorf("add peer: %w", err)
	}
	peerPrefix := netip.MustParsePrefix("10.77.0.1/32")
	if err := dev.ReplacePeerAllowedIPs(peerPub, []netip.Prefix{peerPrefix}); err != nil {
		return fmt.Errorf("set allowed IPs: %w", err)
	}
	// Endpoint goes through the SOCKS5+WS tunnel.
	if err := dev.SetPeerEndpoint(peerPub, wgPeerEndpoint); err != nil {
		return fmt.Errorf("set peer endpoint: %w", err)
	}
	if err := dev.SetPeerPersistentKeepaliveInterval(peerPub, 5); err != nil {
		return fmt.Errorf("set keepalive: %w", err)
	}

	log.Printf("calling dev.Up() — this opens the SOCKS5+WS+GostUDPTun connection")
	if err := dev.Up(); err != nil {
		return fmt.Errorf("bring device up: %w", err)
	}
	log.Printf("dev.Up() returned — WireGuard is up (or failed silently)")

	// ── 5. Wait for WG handshake ──────────────────────────────────────────────
	// The device sends handshake initiations automatically.
	// We wait up to 15 seconds for the server log to show a handshake.

	log.Printf("waiting 15s for WireGuard handshake (check server logs above)...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	handshakeFound := false
	for {
		select {
		case <-ctx.Done():
			if !handshakeFound {
				return fmt.Errorf("no WireGuard handshake after 15s — see server logs above.\n"+
					"If you see '[client-wg] Sending handshake initiation' but no server-side response,\n"+
					"the SOCKS5+WS tunnel is open but WG handshake failed (key mismatch is impossible\n"+
					"since we generated matching keys — indicates a routing issue).\n"+
					"If you see no '[client-wg] Sending handshake initiation', dev.Up() silently\n"+
					"failed to open a UDP socket (GostUDPTun not taking effect).")
			}
			return nil
		case <-ticker.C:
			content, _ := os.ReadFile(logFile.Name())
			logStr := string(content)
			if strings.Contains(logStr, "ws: connection from") {
				log.Printf("✓ server received WebSocket connection")
			}
			if strings.Contains(logStr, "handshake") {
				log.Printf("✓ WireGuard handshake detected in server logs!")
				handshakeFound = true
				// Give it another second to complete, then exit.
				time.Sleep(1 * time.Second)
				cancel()
			}
		}
	}
}

// singleStackUDPNetwork rejects udp6 — mirrors browser/main.go exactly.
type singleStackUDPNetwork struct {
	gonnect.Network
}

func (n *singleStackUDPNetwork) ListenUDP(ctx context.Context, network, laddr string) (gonnect.UDPConn, error) {
	if network == "udp6" {
		return nil, syscall.EAFNOSUPPORT
	}
	return n.Network.ListenUDP(ctx, network, laddr)
}

func (n *singleStackUDPNetwork) ListenUDPConfig(ctx context.Context, lc *gonnect.ListenConfig, network, laddr string) (gonnect.UDPConn, error) {
	if network == "udp6" {
		return nil, syscall.EAFNOSUPPORT
	}
	return n.Network.ListenUDPConfig(ctx, lc, network, laddr)
}

// ── crypto helpers ────────────────────────────────────────────────────────────

func genKeyPair() ([32]byte, [32]byte, error) {
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		return [32]byte{}, [32]byte{}, err
	}
	priv[0] &= 248
	priv[31] = (priv[31] & 127) | 64

	out, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		return [32]byte{}, [32]byte{}, err
	}
	var pub [32]byte
	copy(pub[:], out)
	return priv, pub, nil
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func repoRoot() string {
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return "."
	}
	return strings.TrimSpace(string(out))
}
