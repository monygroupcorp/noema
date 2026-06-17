// tee-wg-server — userspace WireGuard server + SOCKS5+WS proxy for TEE runner.
//
// No /dev/net/tun or NET_ADMIN capability required.
//
//   - SOCKS5+WS on port 8080:  browser WASM sends WireGuard UDP packets through
//     this proxy using the Gost UDP TUN extension (asciimoth/socksgo protocol).
//   - WireGuard on UDP 51820:  real OS socket; receives WG packets relayed by the
//     SOCKS5 proxy and decrypts them via the gVisor vtun.
//   - HTTP reverse proxy on vtun 10.13.0.1:7998: exposes the runner at
//     127.0.0.1:7998 through the encrypted WireGuard tunnel.
//
// Required env:
//
//	WG_PRIVATE_KEY   base64 WireGuard private key (from wg genkey)
//	WG_CLIENT_PUBKEY base64 of the browser's WireGuard public key
//	RUNNER_UPSTREAM  runner HTTP address (default: http://127.0.0.1:7998)
//	WG_LISTEN_PORT   UDP listen port (default: 51820)
//	WG_TUNNEL_IP     server tunnel IP (default: 10.13.0.1)
//	WG_PEER_IP       peer (browser) tunnel IP (default: 10.13.0.2)
//	SOCKS_ADDR       SOCKS5+WS listen address (default: 0.0.0.0:8080)
package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"time"

	conn "github.com/asciimoth/batchudp"
	"github.com/asciimoth/gonnect"
	"github.com/asciimoth/gonnect-netstack/vtun"
	"github.com/asciimoth/socksgo"
	"github.com/asciimoth/socksgo/protocol"
	"github.com/asciimoth/wgo/device"
	cws "github.com/coder/websocket"
)

func main() {
	privKeyB64 := mustEnv("WG_PRIVATE_KEY")
	clientPubKeyB64 := mustEnv("WG_CLIENT_PUBKEY")
	runnerUpstream := envOr("RUNNER_UPSTREAM", "http://127.0.0.1:7998")
	listenPort := uint16(mustUint16(envOr("WG_LISTEN_PORT", "51820")))
	tunnelIPStr := envOr("WG_TUNNEL_IP", "10.13.0.1")
	peerIPStr := envOr("WG_PEER_IP", "10.13.0.2")
	httpListenAddr := envOr("WG_LISTEN_ADDR", tunnelIPStr+":7998")
	socksAddr := envOr("SOCKS_ADDR", "0.0.0.0:8080")

	privKey, err := parseKey(privKeyB64)
	if err != nil {
		log.Fatalf("parse WG_PRIVATE_KEY: %v", err)
	}
	clientPubKey, err := parseKey(clientPubKeyB64)
	if err != nil {
		log.Fatalf("parse WG_CLIENT_PUBKEY: %v", err)
	}

	tunnelIP, err := netip.ParseAddr(tunnelIPStr)
	if err != nil {
		log.Fatalf("parse WG_TUNNEL_IP: %v", err)
	}
	peerIP, err := netip.ParseAddr(peerIPStr)
	if err != nil {
		log.Fatalf("parse WG_PEER_IP: %v", err)
	}

	log.Printf("starting tee-wg-server tunnel=%s peer=%s upstream=%s udp=%d socks=%s",
		tunnelIP, peerIP, runnerUpstream, listenPort, socksAddr)

	// Build virtual TUN backed by gVisor netstack — no /dev/net/tun needed.
	vt, err := (&vtun.Opts{
		LocalAddrs:     []netip.Addr{tunnelIP},
		NoLoopbackAddr: true,
		Name:           "tee-wg",
	}).Build()
	if err != nil {
		log.Fatalf("build vtun: %v", err)
	}
	defer vt.Close()

	select {
	case ev := <-vt.Events():
		log.Printf("vtun ready event=%d", ev)
	case <-time.After(5 * time.Second):
		log.Fatal("vtun ready timeout")
	}

	// WireGuard device using real OS UDP — no SOCKS5 needed on the server side.
	osNet := gonnect.DefaultNetwork(nil)
	dev := device.NewDevice(vt, conn.NewDefaultBind(osNet), device.NewLogger(device.LogLevelDebug, "[tee-wg] "))
	defer dev.Close()

	if err := dev.SetPrivateKey(device.NoisePrivateKey(privKey)); err != nil {
		log.Fatalf("set private key: %v", err)
	}
	if err := dev.SetListenPort(listenPort); err != nil {
		log.Fatalf("set listen port: %v", err)
	}

	peerPub := device.NoisePublicKey(clientPubKey)
	if _, err := dev.NewPeer(peerPub); err != nil {
		log.Fatalf("add peer: %v", err)
	}
	peerPrefix, _ := netip.ParsePrefix(peerIPStr + "/32")
	if err := dev.ReplacePeerAllowedIPs(peerPub, []netip.Prefix{peerPrefix}); err != nil {
		log.Fatalf("set allowed IPs: %v", err)
	}
	if err := dev.Up(); err != nil {
		log.Fatalf("bring device up: %v", err)
	}
	log.Printf("WireGuard up — UDP :%d, vtun %s, peer %s/32", listenPort, tunnelIP, peerIP)

	// Reverse proxy on vtun: HTTP from inside the WG tunnel → runner.
	upstream, err := url.Parse(runnerUpstream)
	if err != nil {
		log.Fatalf("parse runner upstream: %v", err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	ln, err := vt.Listen(context.Background(), "tcp", httpListenAddr)
	if err != nil {
		log.Fatalf("listen on vtun %s: %v", httpListenAddr, err)
	}
	log.Printf("HTTP proxy on vtun %s → %s", httpListenAddr, runnerUpstream)
	go func() {
		if err := http.Serve(ln, proxy); err != nil {
			log.Printf("vtun http proxy: %v", err)
		}
	}()

	// SOCKS5+WS server — replaces gost.
	// Browser WASM (asciimoth/socksgo client) connects here and sends WireGuard
	// UDP packets using the Gost UDP TUN extension (CmdGostUDPTun = 0xF3).
	// We use the same socksgo library on both sides: guaranteed compatibility.
	socks := &socksgo.Server{
		Auth: (&protocol.AuthHandlers{}).Add(&protocol.NoAuthHandler{}),
		// DefaultCommandHandlers includes CmdGostUDPTun (0xF3).
		Handlers: socksgo.DefaultCommandHandlers,
		// osNet provides real OS UDP sockets for forwarding WG packets.
		PacketDialer:   osNet.PacketDial,
		PacketListener: osNet.ListenPacket,
		Dialer:         osNet.Dial,
	}

	socksLn, err := net.Listen("tcp", socksAddr)
	if err != nil {
		log.Fatalf("listen SOCKS5+WS %s: %v", socksAddr, err)
	}
	log.Printf("SOCKS5+WS server on %s (replaces gost)", socksAddr)

	// Serve WebSocket-based SOCKS5 connections.
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := cws.Accept(w, r, &cws.AcceptOptions{
			InsecureSkipVerify: true, // TLS terminated by RunPod proxy
		})
		if err != nil {
			log.Printf("ws accept: %v", err)
			return
		}
		go socks.AcceptWS(r.Context(), wsConn, false)
	})

	log.Printf("ready — serving SOCKS5+WS on %s", socksAddr)
	if err := http.Serve(socksLn, mux); err != nil {
		log.Fatalf("socks5+ws serve: %v", err)
	}
}

func parseKey(b64 string) ([32]byte, error) {
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return [32]byte{}, fmt.Errorf("base64 decode: %w", err)
	}
	if len(b) != 32 {
		return [32]byte{}, fmt.Errorf("expected 32 bytes, got %d", len(b))
	}
	var k [32]byte
	copy(k[:], b)
	return k, nil
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env %s not set", key)
	}
	return v
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func mustUint16(s string) uint16 {
	n, err := strconv.ParseUint(s, 10, 16)
	if err != nil {
		log.Fatalf("parse uint16 %q: %v", s, err)
	}
	return uint16(n)
}
