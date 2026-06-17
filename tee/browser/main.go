//go:build js && wasm

package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"syscall"
	"syscall/js"
	"time"

	conn "github.com/asciimoth/batchudp"
	"github.com/asciimoth/gonnect"
	"github.com/asciimoth/gonnect-netstack/vtun"
	"github.com/asciimoth/socksgo"
	"github.com/asciimoth/wgo/device"
	"golang.org/x/crypto/curve25519"
)

type app struct {
	mu    sync.Mutex
	vt    *vtun.VTun
	dev   *device.Device
	httpc *http.Client
}

type connectConfig struct {
	ProxyURL        string `json:"proxyUrl"`
	LocalTunnelAddr string `json:"localTunnelAddr"`
	LocalPrivateKey string `json:"localPrivateKey"`
	ListenPort      uint16 `json:"listenPort"`
	PeerPublicKey   string `json:"peerPublicKey"`
	PeerEndpoint    string `json:"peerEndpoint"`
	PeerAllowedIPs  string `json:"peerAllowedIPs"`
	PeerKeepalive   uint16 `json:"peerKeepalive"`
}

func main() {
	a := &app{}
	js.Global().Set("wgGenerateKeys", promiseFunc(a.generateKeys))
	js.Global().Set("wgConnect", promiseFunc(a.connect))
	js.Global().Set("wgDisconnect", promiseFunc(a.disconnect))
	js.Global().Set("wgRequest", promiseFunc(a.request))
	// wgStream uses callbacks instead of a Promise so tokens can arrive incrementally.
	js.Global().Set("wgStream", js.FuncOf(a.stream))
	logLine("wasm", "bindings ready")
	select {}
}

func promiseFunc(fn func([]js.Value) (any, error)) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) any {
		handler := js.FuncOf(func(this js.Value, promiseArgs []js.Value) any {
			resolve := promiseArgs[0]
			reject := promiseArgs[1]
			go func() {
				result, err := fn(args)
				if err != nil {
					logLine("error", err.Error())
					reject.Invoke(err.Error())
					return
				}
				resolve.Invoke(result)
			}()
			return nil
		})
		promise := js.Global().Get("Promise").New(handler)
		handler.Release()
		return promise
	})
}

func (a *app) generateKeys(_ []js.Value) (any, error) {
	sk, err := generatePrivateKey()
	if err != nil {
		return nil, fmt.Errorf("generate private key: %w", err)
	}
	pk, err := sk.publicKey()
	if err != nil {
		return nil, fmt.Errorf("derive public key: %w", err)
	}
	return mustJSON(map[string]string{
		"privateKey": sk.String(),
		"publicKey":  pk.String(),
	}), nil
}

func (a *app) connect(args []js.Value) (any, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("expected single JSON config argument")
	}
	var cfg connectConfig
	if err := json.Unmarshal([]byte(args[0].String()), &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if strings.TrimSpace(cfg.ProxyURL) == "" {
		return nil, fmt.Errorf("proxyUrl is required")
	}
	if strings.TrimSpace(cfg.PeerPublicKey) == "" {
		return nil, fmt.Errorf("peerPublicKey is required")
	}

	localAddr, err := netip.ParseAddr(strings.TrimSpace(cfg.LocalTunnelAddr))
	if err != nil {
		return nil, fmt.Errorf("parse localTunnelAddr: %w", err)
	}
	privateKey, err := parseOrGeneratePrivateKey(strings.TrimSpace(cfg.LocalPrivateKey))
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	peerPublic, err := parsePublicKey(strings.TrimSpace(cfg.PeerPublicKey))
	if err != nil {
		return nil, fmt.Errorf("parse peerPublicKey: %w", err)
	}
	allowedIPs, err := parseAllowedIPs(cfg.PeerAllowedIPs)
	if err != nil {
		return nil, err
	}

	a.teardown()

	socksClient, err := socksgo.ClientFromURL(cfg.ProxyURL)
	if err != nil {
		return nil, fmt.Errorf("build socks client: %w", err)
	}
	socksClient.Filter = nil
	// wss:// sets IsTLS()=true which blocks UDP by default. The UDP is tunneled
	// through the encrypted WSS stream (GostUDPTun = UDP-over-TCP), so there is
	// no plaintext exposure — InsecureUDP is safe to enable here.
	socksClient.GostUDPTun = true
	socksClient.InsecureUDP = true

	network := &singleStackUDPNetwork{Network: socksClient}

	vt, err := (&vtun.Opts{
		LocalAddrs:     []netip.Addr{localAddr},
		NoLoopbackAddr: true,
		Name:           "tee-wg",
	}).Build()
	if err != nil {
		return nil, fmt.Errorf("build vtun: %w", err)
	}
	select {
	case event := <-vt.Events():
		logLine("vtun", fmt.Sprintf("ready event=%d", event))
	case <-time.After(3 * time.Second):
		_ = vt.Close()
		return nil, fmt.Errorf("timed out waiting for vtun")
	}

	dev := device.NewDevice(vt, conn.NewDefaultBind(network), &deviceLogger{})

	if err := dev.SetPrivateKey(privateKey.toDevice()); err != nil {
		dev.Close(); _ = vt.Close()
		return nil, fmt.Errorf("set private key: %w", err)
	}
	if err := dev.SetListenPort(cfg.ListenPort); err != nil {
		dev.Close(); _ = vt.Close()
		return nil, fmt.Errorf("set listen port: %w", err)
	}
	dev.RemoveAllPeers()
	if _, err := dev.NewPeer(peerPublic.toDevice()); err != nil {
		dev.Close(); _ = vt.Close()
		return nil, fmt.Errorf("add peer: %w", err)
	}
	if err := dev.SetPeerProtocolVersion(peerPublic.toDevice(), 1); err != nil {
		dev.Close(); _ = vt.Close()
		return nil, fmt.Errorf("set peer protocol version: %w", err)
	}
	if len(allowedIPs) > 0 {
		if err := dev.ReplacePeerAllowedIPs(peerPublic.toDevice(), allowedIPs); err != nil {
			dev.Close(); _ = vt.Close()
			return nil, fmt.Errorf("set allowed IPs: %w", err)
		}
	}
	if ep := strings.TrimSpace(cfg.PeerEndpoint); ep != "" {
		if err := dev.SetPeerEndpoint(peerPublic.toDevice(), ep); err != nil {
			dev.Close(); _ = vt.Close()
			return nil, fmt.Errorf("set peer endpoint: %w", err)
		}
	}
	if cfg.PeerKeepalive > 0 {
		if err := dev.SetPeerPersistentKeepaliveInterval(peerPublic.toDevice(), cfg.PeerKeepalive); err != nil {
			dev.Close(); _ = vt.Close()
			return nil, fmt.Errorf("set keepalive: %w", err)
		}
	}
	if err := dev.Up(); err != nil {
		dev.Close(); _ = vt.Close()
		return nil, fmt.Errorf("bring device up: %w", err)
	}

	httpc := &http.Client{
		Transport: &http.Transport{
			DialContext:       vt.Dial,
			DisableKeepAlives: false,
		},
	}

	a.mu.Lock()
	a.vt = vt
	a.dev = dev
	a.httpc = httpc
	a.mu.Unlock()

	pk, _ := privateKey.publicKey()
	logLine("app", fmt.Sprintf("tunnel up local=%s peer=%s", localAddr, peerPublic.String()))
	return mustJSON(map[string]string{
		"message":        "tunnel up",
		"localPublicKey": pk.String(),
	}), nil
}

func (a *app) disconnect(_ []js.Value) (any, error) {
	a.teardown()
	return mustJSON(map[string]string{"message": "disconnected"}), nil
}

func (a *app) teardown() {
	a.mu.Lock()
	dev := a.dev
	vt := a.vt
	a.dev = nil
	a.vt = nil
	a.httpc = nil
	a.mu.Unlock()
	if dev != nil {
		dev.Close()
	}
	if vt != nil {
		_ = vt.Close()
	}
	logLine("app", "tunnel down")
}

// request makes a single HTTP request through the tunnel and returns the full response body.
// Signature: wgRequest(url, method, bodyJSON) → Promise<string>
func (a *app) request(args []js.Value) (any, error) {
	targetURL := args[0].String()
	method := args[1].String()
	bodyJSON := args[2].String()

	a.mu.Lock()
	httpc := a.httpc
	a.mu.Unlock()
	if httpc == nil {
		return nil, fmt.Errorf("not connected")
	}

	req, err := http.NewRequestWithContext(context.Background(), method, targetURL, strings.NewReader(bodyJSON))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// stream fires onChunk(dataJSON) for each SSE token, then onDone() or onError(msg).
// Signature: wgStream(url, bodyJSON, onChunk, onDone, onError) — no return value.
func (a *app) stream(_ js.Value, args []js.Value) any {
	if len(args) < 5 {
		return nil
	}
	targetURL := args[0].String()
	bodyJSON := args[1].String()
	onChunk := args[2]
	onDone := args[3]
	onError := args[4]

	go func() {
		a.mu.Lock()
		httpc := a.httpc
		a.mu.Unlock()
		if httpc == nil {
			onError.Invoke("not connected")
			return
		}

		req, err := http.NewRequestWithContext(
			context.Background(),
			http.MethodPost,
			targetURL,
			strings.NewReader(bodyJSON),
		)
		if err != nil {
			onError.Invoke(err.Error())
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")

		resp, err := httpc.Do(req)
		if err != nil {
			onError.Invoke(err.Error())
			return
		}
		defer resp.Body.Close()

		logLine("stream", fmt.Sprintf("status=%s", resp.Status))

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := line[6:]
			if data == "[DONE]" {
				break
			}
			onChunk.Invoke(data)
		}
		if err := scanner.Err(); err != nil {
			onError.Invoke(err.Error())
			return
		}
		onDone.Invoke()
	}()

	return nil
}

// ---- network adapter ----

// singleStackUDPNetwork rejects udp6 ListenUDP calls — socksgo proxy is IPv4-only.
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

// ---- crypto ----

type noisePrivateKey [32]byte
type noisePublicKey [32]byte

func generatePrivateKey() (noisePrivateKey, error) {
	var k noisePrivateKey
	if _, err := rand.Read(k[:]); err != nil {
		return noisePrivateKey{}, err
	}
	k[0] &= 248
	k[31] = (k[31] & 127) | 64
	return k, nil
}

func parseOrGeneratePrivateKey(raw string) (noisePrivateKey, error) {
	if raw == "" {
		return generatePrivateKey()
	}
	return parsePrivateKey(raw)
}

func parsePrivateKey(raw string) (noisePrivateKey, error) {
	var k noisePrivateKey
	if err := decode32(k[:], raw); err != nil {
		return noisePrivateKey{}, err
	}
	k[0] &= 248
	k[31] = (k[31] & 127) | 64
	return k, nil
}

func parsePublicKey(raw string) (noisePublicKey, error) {
	var k noisePublicKey
	if err := decode32(k[:], raw); err != nil {
		return noisePublicKey{}, err
	}
	return k, nil
}

func decode32(dst []byte, raw string) error {
	raw = strings.TrimSpace(raw)
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil && len(b) == len(dst) {
		copy(dst, b)
		return nil
	}
	if b, err := hex.DecodeString(raw); err == nil && len(b) == len(dst) {
		copy(dst, b)
		return nil
	}
	return fmt.Errorf("expected 32-byte key (base64 or hex)")
}

func (k noisePrivateKey) publicKey() (noisePublicKey, error) {
	var pk noisePublicKey
	out, err := curve25519.X25519(k[:], curve25519.Basepoint)
	if err != nil {
		return noisePublicKey{}, err
	}
	copy(pk[:], out)
	return pk, nil
}

func (k noisePrivateKey) String() string { return base64.StdEncoding.EncodeToString(k[:]) }
func (k noisePublicKey) String() string  { return base64.StdEncoding.EncodeToString(k[:]) }

func (k noisePrivateKey) toDevice() device.NoisePrivateKey { return device.NoisePrivateKey(k) }
func (k noisePublicKey) toDevice() device.NoisePublicKey   { return device.NoisePublicKey(k) }

func parseAllowedIPs(raw string) ([]netip.Prefix, error) {
	raw = strings.ReplaceAll(raw, ",", "\n")
	var out []netip.Prefix
	for _, item := range strings.Split(raw, "\n") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		p, err := netip.ParsePrefix(item)
		if err != nil {
			return nil, fmt.Errorf("parse allowed IP %q: %w", item, err)
		}
		out = append(out, p)
	}
	return out, nil
}

// ---- device logger ----

type deviceLogger struct{}

func (l *deviceLogger) Debug(args ...any)            { logLine("wg/debug", fmt.Sprint(args...)) }
func (l *deviceLogger) Debugf(f string, a ...any)   { logLine("wg/debug", fmt.Sprintf(f, a...)) }
func (l *deviceLogger) Info(args ...any)             { logLine("wg/info", fmt.Sprint(args...)) }
func (l *deviceLogger) Infof(f string, a ...any)    { logLine("wg/info", fmt.Sprintf(f, a...)) }
func (l *deviceLogger) Warn(args ...any)             { logLine("wg/warn", fmt.Sprint(args...)) }
func (l *deviceLogger) Warnf(f string, a ...any)    { logLine("wg/warn", fmt.Sprintf(f, a...)) }
func (l *deviceLogger) Err(args ...any)              { logLine("wg/err", fmt.Sprint(args...)) }
func (l *deviceLogger) Errf(f string, a ...any)     { logLine("wg/err", fmt.Sprintf(f, a...)) }
func (l *deviceLogger) Fatal(args ...any)            { logLine("wg/fatal", fmt.Sprint(args...)) }
func (l *deviceLogger) Fatalf(f string, a ...any)   { logLine("wg/fatal", fmt.Sprintf(f, a...)) }

// ---- util ----

func logLine(kind, msg string) {
	line := fmt.Sprintf("[%s] %s", strings.ToUpper(kind), msg)
	fmt.Println(line)
	if fn := js.Global().Get("teeLog"); fn.Type() == js.TypeFunction {
		fn.Invoke(line)
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":"json marshal failed"}`
	}
	return string(b)
}
