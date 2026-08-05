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
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
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
	// Write logs directly to /tmp/wg-server.log in addition to stderr.
	// The entrypoint's >/tmp/wg-server.log 2>&1 redirect is unreliable in
	// some container environments; opening the file here guarantees log output.
	if lf, err := os.OpenFile("/tmp/wg-server.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
		log.SetOutput(io.MultiWriter(os.Stderr, lf))
		defer lf.Close()
	}

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
	// Health check — RunPod probes port 8080 with plain HTTP; return 200 to prevent restart loop.
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	// Debug log endpoint — reachable through the publicly proxied :8080, so when the
	// platform issued a per-session RUNNER_TOKEN it is required as a Bearer token
	// (the platform's wglog proxy sends it). No token = local dev, open.
	// Exposes /tmp/wg-server.log: everything tee-wg-server has printed to stdout/stderr.
	// ?tail=N returns only the last N lines (default: all).
	runnerToken := os.Getenv("RUNNER_TOKEN")
	mux.HandleFunc("/debug/wglog", func(w http.ResponseWriter, r *http.Request) {
		if runnerToken != "" && r.Header.Get("Authorization") != "Bearer "+runnerToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		data, err := os.ReadFile("/tmp/wg-server.log")
		if err != nil {
			http.Error(w, "log not found: "+err.Error(), http.StatusNotFound)
			return
		}
		if tailStr := r.URL.Query().Get("tail"); tailStr != "" {
			if n, err2 := strconv.Atoi(tailStr); err2 == nil && n > 0 {
				lines := strings.Split(string(data), "\n")
				if len(lines) > n {
					lines = lines[len(lines)-n:]
				}
				data = []byte(strings.Join(lines, "\n"))
			}
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(data)
	})
	// ws-test: manual WebSocket reachability probe. Test from browser DevTools:
	//   new WebSocket('wss://PODID-8080.proxy.runpod.net/ws-test')
	// Logs whether RunPod's proxy forwards the Upgrade header.
	mux.HandleFunc("/ws-test", func(w http.ResponseWriter, r *http.Request) {
		upgrade := r.Header.Get("Upgrade")
		wsKey := r.Header.Get("Sec-WebSocket-Key")
		if upgrade == "" && wsKey != "" {
			r.Header.Set("Upgrade", "websocket")
			r.Header.Set("Connection", "Upgrade")
		}
		log.Printf("ws-test: from=%s upgrade=%q wskey=%t", r.RemoteAddr, r.Header.Get("Upgrade"), wsKey != "")
		wsConn, err := cws.Accept(w, r, &cws.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			log.Printf("ws-test: accept error: %v", err)
			return
		}
		log.Printf("ws-test: connected OK")
		_ = wsConn.CloseNow()
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Log every request so we can see whether WebSocket upgrades are reaching the server
		// and whether RunPod's proxy forwards the Upgrade header.
		upgrade := r.Header.Get("Upgrade")
		wsKey := r.Header.Get("Sec-WebSocket-Key")
		log.Printf("http: %s %s Upgrade=%q WsKey=%t from=%s", r.Method, r.URL.Path, upgrade, wsKey != "", r.RemoteAddr)

		// RunPod's Nginx proxy strips the Upgrade and Connection headers (standard proxy
		// behaviour without explicit proxy_set_header Upgrade). The Sec-WebSocket-Key header
		// survives because it's not in the forbidden/hop-by-hop list. If the key is present
		// the client is definitely attempting a WebSocket handshake — restore the missing
		// hop-by-hop headers so cws.Accept can complete the upgrade correctly.
		if upgrade == "" && wsKey != "" {
			r.Header.Set("Upgrade", "websocket")
			r.Header.Set("Connection", "Upgrade")
			upgrade = "websocket"
			log.Printf("http: restored Upgrade header (proxy stripping detected)")
		}

		if upgrade != "websocket" {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
			return
		}
		log.Printf("ws: connection from %s path=%s", r.RemoteAddr, r.URL.Path)
		wsConn, err := cws.Accept(w, r, &cws.AcceptOptions{
			InsecureSkipVerify: true, // TLS terminated by RunPod proxy
		})
		if err != nil {
			log.Printf("ws: accept error: %v", err)
			return
		}
		log.Printf("ws: socks5 session started")
		// Block — r.Context() must stay alive for the lifetime of the SOCKS5 session.
		// http.Server runs each handler in its own goroutine, so blocking is correct.
		err = socks.AcceptWS(r.Context(), wsConn, false)
		log.Printf("ws: socks5 session ended: %v", err)
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
