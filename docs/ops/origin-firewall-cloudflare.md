# Origin firewall: restrict 80/443 to Cloudflare — runbook

**Problem:** noema.art / www / app / staging sit behind Cloudflare (DNS cut over, proxied —
`cloudflare-proxy-nameserver-cutover`), but the droplet's own firewall still accepts tcp/80 and
tcp/443 from anywhere. `curl --resolve <host>:443:64.227.15.104 https://<host>/` reaches the real
site directly — valid Let's Encrypt cert, `server: Caddy` — with no Cloudflare proxy or WAF in the
path. Confirmed live again 2026-11-21 (`https 443: 200`, `http 80: 308`). This item closes that
bypass by allowing 80/443 only from Cloudflare's published IP ranges.

**2026-11-21: applied, and did not hold.** The ufw rules below were applied on the droplet
(44 `cf-origin-lock` rules, the old blanket 80/443 allows gone, SSH untouched, daily timer
enabled) — but the direct-origin curl checks still returned `200`/`308`. Root cause: Caddy's
80/443 are **Docker-published** (`0.0.0.0:80`/`0.0.0.0:443` -> the Caddy container), so inbound
connections to them are DNAT'd and traverse the **FORWARD** chain, never **INPUT** — ufw only
filters INPUT, so none of the rules above ever see this traffic at all. The script now also
rewrites the **DOCKER-USER** chain (iptables + ip6tables) — the chain Docker itself reserves for
operators to filter forwarded/published-port traffic before Docker's own wide-open rules accept
it — which is the layer that actually gates this. See the script's own header comment for the
full mechanism. Both goal clauses stay open until a direct-origin curl genuinely fails.

**Not executed by this item.** This repo's realm rule is that a seat does not apply firewall/
deploy changes to production — only the operator does. Everything below is ready to apply; the
operator runs the "Apply" section.

## What's here

- `scripts/firewall-cloudflare-only.sh` — fetches Cloudflare's current IPv4 (`cloudflare.com/
  ips-v4`) and IPv6 (`/ips-v6`) ranges and rewrites **two** layers to allow only those ranges on
  80/443, denying everyone else: this host's ufw rules (INPUT), and the `DOCKER-USER` chain in
  both `iptables` and `ip6tables` (FORWARD, for Docker-published ports — see the "applied, and
  did not hold" note above for why this layer is required). Never touches any other port or
  container egress (SSH stays as-is; the `DOCKER-USER` rules are scoped to the public interface
  only, autodetected via the default route, so a container's own outbound traffic — which arrives
  via the bridge interface, not the public NIC — never matches). Idempotent — re-running it
  refreshes both allow-lists to whatever Cloudflare currently publishes. Aborts without changing
  anything if a range fetch fails, is empty, or doesn't parse as CIDRs. Supports `--dry-run`
  (prints the commands it would run, changes nothing). If `DOCKER-USER` doesn't exist in either
  `iptables` or `ip6tables` (Docker not installed, or its iptables integration disabled), it warns
  and skips that layer rather than failing — the ufw layer still applies.
- `ops/systemd/noema-firewall-cloudflare.{service,timer}` — runs the script daily (03:41 UTC +
  jitter), since Cloudflare's ranges change occasionally and a stale allow-list would eventually
  either reject real Cloudflare traffic or leave a range Cloudflare no longer uses still open.

The script also looks for a pre-existing ufw rule that already blanket-allows 80/443 from
"Anywhere" (e.g. a default `ufw allow 80,443/tcp` from initial server setup) and removes it, since
such a rule would otherwise shadow the restriction — ufw/netfilter matches rules top-down, and an
earlier ALLOW wins over a later DENY. It only auto-removes a *raw port-number* rule like that; if
80/443 is instead opened via an ufw **application profile** (e.g. `Nginx Full`), the script can't
tell from the profile name alone whether it covers those ports and will print a `WARNING` naming
it instead of touching it — check `ufw app info "<name>"` by hand in that case before/after
applying.

## Before applying — pre-flight on the droplet

```bash
ssh noema
sudo ufw status verbose          # see what's live today
sudo ufw app list                # any custom profiles? check each with: ufw app info "<name>"
sudo iptables -nL DOCKER-USER    # confirm the chain exists (it should, Caddy's ports are Docker-published)
docker ps --format '{{.Names}}\t{{.Ports}}'   # confirm which container(s) actually publish 80/443
ip route show default            # the interface the script will scope DOCKER-USER rules to
```

Confirm SSH is allowed (it should already be, and this script never touches it) before doing
anything else — don't want to find out otherwise after reloading ufw.

## Apply

```bash
ssh noema
cd /opt/noema
./scripts/firewall-cloudflare-only.sh --dry-run    # review the plan first
sudo ./scripts/firewall-cloudflare-only.sh          # apply
sudo ufw status numbered                            # confirm: allows tagged "cf-origin-lock", then a deny 80/tcp and deny 443/tcp
sudo iptables -L DOCKER-USER -n --line-numbers | grep cf-origin-lock    # confirm the FORWARD-chain rules landed
sudo ip6tables -L DOCKER-USER -n --line-numbers | grep cf-origin-lock
```

Install the daily refresh timer:

```bash
sudo cp /opt/noema/ops/systemd/noema-firewall-cloudflare.service /opt/noema/ops/systemd/noema-firewall-cloudflare.timer /etc/systemd/system/
sudo chmod +x /opt/noema/scripts/firewall-cloudflare-only.sh
sudo systemctl daemon-reload
sudo systemctl enable --now noema-firewall-cloudflare.timer
journalctl -u noema-firewall-cloudflare.service --no-pager | tail -20
```

## Verify (run from a host outside Cloudflare's ranges, e.g. not through the droplet's own network)

**1. The direct-origin bypass is closed** (goal clause 1):

```bash
curl -m 10 -o /dev/null -w '%{http_code}\n' --resolve noema.art:443:64.227.15.104 https://noema.art/
curl -m 10 -o /dev/null -w '%{http_code}\n' --resolve noema.art:80:64.227.15.104 http://noema.art/
```

Both should time out or be refused/reset — not `200`, and the `:80` one should not give the
existing `308` redirect either (that redirect itself is served by the origin, so it must also stop
answering directly).

**2. No regression — the four hosts still work through Cloudflare** (goal clause 2, same checks as
`cloudflare-proxy-nameserver-cutover` clauses 2–3):

```bash
for h in noema.art www.noema.art app.noema.art staging.noema.art; do
  curl -sI --max-time 10 "https://$h/" | grep -qi '^cf-ray:' || echo "MISSING cf-ray: $h"
done

for h in noema.art www.noema.art app.noema.art staging.noema.art; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$h/")
  [ "$code" = "200" ] || echo "NOT 200 ($code): $h"
done
```

Both loops should print nothing.

## Rollback

```bash
ssh noema
sudo systemctl disable --now noema-firewall-cloudflare.timer

# ufw (INPUT) layer
sudo ufw status numbered                 # find the rules tagged "# cf-origin-lock"
sudo ufw --force delete <N>               # remove each one, highest number first
sudo ufw allow 80,443/tcp                 # reopen to everyone if reverting fully

# DOCKER-USER (FORWARD) layer — same idea, reverse order
sudo iptables -L DOCKER-USER -n --line-numbers | grep cf-origin-lock   # find the line numbers
sudo iptables -D DOCKER-USER <N>                                       # highest number first
sudo ip6tables -L DOCKER-USER -n --line-numbers | grep cf-origin-lock
sudo ip6tables -D DOCKER-USER <N>
```

## Known gap

Cloudflare's own documented caveat applies: anyone who already knows the origin IP and sources
their traffic from *within* a Cloudflare range (e.g. by routing through another Cloudflare-fronted
site, or Cloudflare Workers) can still reach the origin directly — an IP allow-list can't
distinguish "real Cloudflare proxy traffic for this zone" from "any request Cloudflare happens to
relay." Closing that fully needs Cloudflare's **Authenticated Origin Pulls** (mutual TLS between
Cloudflare and the origin) layered on top of this; out of scope for this item, which matches the
goal as written (IP-range allow-list only).

## If the droplet turns out to use iptables directly, not ufw

`scripts/firewall-cloudflare-only.sh` only drives `ufw` and exits with an error if `ufw` isn't
present — `production-deploy.md`/`staging-deploy.md` don't document the droplet's firewall layer
either way, and `ufw` is Ubuntu's default, pre-installed firewall front-end, so that's the assumed
case. If `ufw status` isn't a recognized command on the droplet, the equivalent raw-iptables shape
is: an `ACCEPT` rule per Cloudflare CIDR (`iptables -A INPUT -p tcp --dport 80 -s <cidr> -j
ACCEPT`, and the `-p tcp --dport 443` / `ip6tables` equivalents) inserted before a final `iptables
-A INPUT -p tcp --dport 80 -j DROP` (and 443), persisted via `iptables-save` into whatever
persistence mechanism the droplet uses (`netfilter-persistent`, `iptables-persistent`, or a systemd
unit that restores the rules on boot). This item does not build that path since there's no
evidence it's needed.
