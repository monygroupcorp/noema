// tee-wg-server — userspace WireGuard server for TEE runner.
//
// Uses gVisor netstack (same as the browser WASM) so no /dev/net/tun or
// NET_ADMIN capability is required. Listens for WireGuard packets on real
// OS UDP port 51820, decrypts them via wgo/device + vtun, and reverse-proxies
// the resulting HTTP traffic to the runner at http://127.0.0.1:7998.
//
// Required env:
//   WG_PRIVATE_KEY   base64 WireGuard private key (from wg genkey)
//   WG_CLIENT_PUBKEY base64 of the browser's WireGuard public key
//   RUNNER_UPSTREAM  runner HTTP address (default: http://127.0.0.1:7998)
//   WG_LISTEN_PORT   UDP listen port (default: 51820)
//   WG_TUNNEL_IP     server tunnel IP (default: 10.13.0.1)
//   WG_PEER_IP       peer (browser) tunnel IP (default: 10.13.0.2)
//   WG_LISTEN_ADDR   HTTP listen address on vtun (default: WG_TUNNEL_IP:7998)

package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
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
	"github.com/asciimoth/wgo/device"
)

func main() {
	privKeyB64 := mustEnv("WG_PRIVATE_KEY")
	clientPubKeyB64 := mustEnv("WG_CLIENT_PUBKEY")
	runnerUpstream := envOr("RUNNER_UPSTREAM", "http://127.0.0.1:7998")
	listenPort := uint16(mustUint16(envOr("WG_LISTEN_PORT", "51820")))
	tunnelIPStr := envOr("WG_TUNNEL_IP", "10.13.0.1")
	peerIPStr := envOr("WG_PEER_IP", "10.13.0.2")
	httpListenAddr := envOr("WG_LISTEN_ADDR", tunnelIPStr+":7998")

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

	log.Printf("starting tee-wg-server tunnel=%s peer=%s upstream=%s udp=%d",
		tunnelIP, peerIP, runnerUpstream, listenPort)

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

	// WireGuard device using real OS UDP (NativeNetwork) — no SOCKS5 needed.
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

	// Reverse proxy: vtun TCP listener → runner
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

	if err := http.Serve(ln, proxy); err != nil {
		log.Fatalf("serve: %v", err)
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

