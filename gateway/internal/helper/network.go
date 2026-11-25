package helper

import (
	"bytes"
	"crypto/sha1"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
)

// Network é o /etc/oee-gateway/network.json (docs/16 §4: a única fonte da rede),
// no formato que o factory init grava (deploy/image/factory/egw-factory-init). Só o
// corte do MVP: campos fora daqui (VLAN, MTU, dns_search, IPv6 automático) são
// recusados, não ignorados, para nunca aplicar meia config.
type Network struct {
	NetworkVersion int     `json:"network_version"`
	Origin         string  `json:"origin,omitempty"`
	Hostname       string  `json:"hostname,omitempty"`
	IT             ITNet   `json:"it"`
	OT             OTNet   `json:"ot"`
	Proxy          *Proxy  `json:"proxy"`
	CABundlePEM    *string `json:"ca_bundle_pem"`
	NTP            NTP     `json:"ntp"`
}

// ITNet é a rede da IT (ETH1, internet).
type ITNet struct {
	MAC       string   `json:"mac"`
	Mode      string   `json:"mode"` // dhcp | static
	Addresses []string `json:"addresses"`
	Gateway   *string  `json:"gateway"`
	DNS       []string `json:"dns"`
	IPv6      string   `json:"ipv6"` // disabled (MVP)
	AllowPing bool     `json:"allow_ping"`
}

// OTNet é a rede da OT (ETH0, CLPs), sempre sem rota padrão.
type OTNet struct {
	MAC            string    `json:"mac"`
	Mode           string    `json:"mode"` // static
	Addresses      []string  `json:"addresses"`
	Routes         []OTRoute `json:"routes"`
	ServiceAddress string    `json:"service_address"`
	LocalUI        bool      `json:"local_ui"`
}

// OTRoute é uma rota estática para outra sub-rede OT.
type OTRoute struct {
	To  string `json:"to"`
	Via string `json:"via"`
}

// Proxy é o proxy HTTP CONNECT da IT.
type Proxy struct {
	URL     string   `json:"url"`
	NoProxy []string `json:"no_proxy,omitempty"`
}

// NTP são as fontes de hora do cliente.
type NTP struct {
	Servers        []string `json:"servers"`
	UseDHCP        bool     `json:"use_dhcp"`
	PublicFallback bool     `json:"public_fallback"`
}

// Limites (docs/rascunhos/gateway-rede-e-instalacao.md §1.3).
const (
	maxOTAddresses = 4
	maxOTRoutes    = 16
	maxDNS         = 4
	maxNTP         = 4
	maxNoProxy     = 16
	maxCABundle    = 64 << 10
)

var (
	hostnameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
	macRe      = regexp.MustCompile(`^[0-9a-f]{2}(:[0-9a-f]{2}){5}$`)
	// Nome de host DNS (NTP, no_proxy): só letras, dígitos, hífen e ponto.
	dnsNameRe = regexp.MustCompile(`^(?i)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$`)
)

// ParseNetwork lê um network.json com campos desconhecidos recusados.
func ParseNetwork(b []byte) (*Network, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var n Network
	if err := dec.Decode(&n); err != nil {
		return nil, fmt.Errorf("network.json inválido: %w", err)
	}
	if dec.More() {
		return nil, errors.New("network.json inválido: conteúdo depois do objeto")
	}
	return &n, nil
}

// Validate confere as regras da rede antes de aplicar. Um erro aqui é melhor que um
// gateway inacessível no campo.
func (n *Network) Validate() error {
	var errs []string
	bad := func(format string, a ...any) { errs = append(errs, fmt.Sprintf(format, a...)) }
	if n.NetworkVersion < 0 {
		bad("network_version negativo")
	}
	if n.Hostname != "" && !hostnameRe.MatchString(n.Hostname) {
		bad("hostname inválido")
	}
	for _, m := range []struct{ name, v string }{{"it.mac", n.IT.MAC}, {"ot.mac", n.OT.MAC}} {
		if m.v != "" && !macRe.MatchString(m.v) {
			bad("%s inválido", m.name)
		}
	}

	// IT.
	var itPrefix netip.Prefix
	switch n.IT.Mode {
	case "dhcp":
		if len(n.IT.Addresses) > 0 || n.IT.Gateway != nil || len(n.IT.DNS) > 0 {
			bad("it em dhcp não leva addresses, gateway nem dns")
		}
	case "static":
		if len(n.IT.Addresses) != 1 {
			bad("it estática precisa de exatamente 1 endereço")
		} else if p, err := hostPrefix(n.IT.Addresses[0]); err != nil {
			bad("it.addresses[0]: %v", err)
		} else {
			itPrefix = p
		}
		if n.IT.Gateway == nil {
			bad("it estática precisa de gateway")
		} else if gw, err := ipv4(*n.IT.Gateway); err != nil {
			bad("it.gateway: %v", err)
		} else if itPrefix.IsValid() && (!itPrefix.Masked().Contains(gw) || gw == itPrefix.Addr()) {
			bad("it.gateway fora da sub-rede da IT (ou igual ao endereço)")
		}
		if len(n.IT.DNS) < 1 || len(n.IT.DNS) > maxDNS {
			bad("it estática precisa de 1 a %d DNS", maxDNS)
		}
		for i, d := range n.IT.DNS {
			if _, err := ipv4(d); err != nil {
				bad("it.dns[%d]: %v", i, err)
			}
		}
	default:
		bad("it.mode deve ser dhcp ou static")
	}
	if n.IT.IPv6 != "disabled" {
		bad("it.ipv6: só disabled no MVP")
	}

	// OT.
	if n.OT.Mode != "static" {
		bad("ot.mode: só static no MVP")
	}
	if len(n.OT.Addresses) > maxOTAddresses {
		bad("ot.addresses: no máximo %d", maxOTAddresses)
	}
	var otPrefixes []netip.Prefix
	for i, a := range n.OT.Addresses {
		p, err := hostPrefix(a)
		if err != nil {
			bad("ot.addresses[%d]: %v", i, err)
			continue
		}
		if linkLocal.Contains(p.Addr()) {
			bad("ot.addresses[%d]: 169.254/16 é do endereço de serviço", i)
		}
		otPrefixes = append(otPrefixes, p.Masked())
	}
	if sp, err := hostPrefix(n.OT.ServiceAddress); err != nil {
		bad("ot.service_address: %v", err)
	} else if sp.Bits() != 16 || !serviceRange(sp.Addr()) {
		bad("ot.service_address deve estar em 169.254.1.0–169.254.254.255/16")
	}
	if len(n.OT.Routes) > maxOTRoutes {
		bad("ot.routes: no máximo %d", maxOTRoutes)
	}
	for i, r := range n.OT.Routes {
		to, err := netip.ParsePrefix(r.To)
		if err != nil || !to.Addr().Is4() {
			bad("ot.routes[%d].to inválido", i)
			continue
		}
		if to.Bits() == 0 {
			bad("ot.routes[%d]: rota padrão proibida na OT", i)
		}
		via, err := ipv4(r.Via)
		if err != nil {
			bad("ot.routes[%d].via: %v", i, err)
			continue
		}
		in := false
		for _, p := range otPrefixes {
			in = in || p.Contains(via)
		}
		if !in {
			bad("ot.routes[%d].via fora das sub-redes OT", i)
		}
	}
	if itPrefix.IsValid() {
		for i, p := range otPrefixes {
			if p.Overlaps(itPrefix.Masked()) {
				bad("ot.addresses[%d] se sobrepõe à sub-rede da IT", i)
			}
		}
	}

	// Proxy, CA e NTP.
	if n.Proxy != nil {
		if err := validProxyURL(n.Proxy.URL); err != nil {
			bad("proxy.url: %v", err)
		}
		if len(n.Proxy.NoProxy) > maxNoProxy {
			bad("proxy.no_proxy: no máximo %d", maxNoProxy)
		}
		for i, np := range n.Proxy.NoProxy {
			if _, err := netip.ParsePrefix(np); err != nil && net.ParseIP(np) == nil && !dnsNameRe.MatchString(np) {
				bad("proxy.no_proxy[%d] inválido", i)
			}
		}
	}
	if n.CABundlePEM != nil {
		if err := validCABundle(*n.CABundlePEM); err != nil {
			bad("ca_bundle_pem: %v", err)
		}
	}
	if len(n.NTP.Servers) > maxNTP {
		bad("ntp.servers: no máximo %d", maxNTP)
	}
	for i, s := range n.NTP.Servers {
		if net.ParseIP(s) == nil && !dnsNameRe.MatchString(s) {
			bad("ntp.servers[%d] inválido", i)
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

var linkLocal = netip.MustParsePrefix("169.254.0.0/16")

// serviceRange: 169.254.1.0–169.254.254.255 (RFC 3927 reserva as pontas).
func serviceRange(a netip.Addr) bool {
	if !linkLocal.Contains(a) {
		return false
	}
	b := a.As4()
	return b[2] >= 1 && b[2] <= 254
}

func ipv4(s string) (netip.Addr, error) {
	a, err := netip.ParseAddr(s)
	if err != nil || !a.Is4() {
		return netip.Addr{}, fmt.Errorf("%q não é IPv4", s)
	}
	if a.IsUnspecified() || a.IsLoopback() || a.IsMulticast() {
		return netip.Addr{}, fmt.Errorf("%q não serve", s)
	}
	return a, nil
}

// hostPrefix: endereço de interface "a.b.c.d/n" (prefixo 8–30).
func hostPrefix(s string) (netip.Prefix, error) {
	p, err := netip.ParsePrefix(s)
	if err != nil || !p.Addr().Is4() {
		return netip.Prefix{}, fmt.Errorf("%q não é IPv4/prefixo", s)
	}
	if p.Bits() < 8 || p.Bits() > 30 {
		return netip.Prefix{}, fmt.Errorf("%q: prefixo fora de /8–/30", s)
	}
	if _, err := ipv4(p.Addr().String()); err != nil {
		return netip.Prefix{}, err
	}
	if p.Addr() == p.Masked().Addr() {
		return netip.Prefix{}, fmt.Errorf("%q é o endereço da rede", s)
	}
	return p, nil
}

func validProxyURL(s string) error {
	if strings.ContainsAny(s, "\r\n\t \"'`$\\") {
		return errors.New("caracteres não permitidos")
	}
	u, err := url.Parse(s)
	if err != nil {
		return errors.New("URL inválida")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("só http:// ou https://")
	}
	if u.Hostname() == "" || u.Port() == "" {
		return errors.New("precisa de host e porta")
	}
	if u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("sem caminho, consulta ou fragmento")
	}
	return nil
}

func validCABundle(s string) error {
	if len(s) > maxCABundle {
		return errors.New("grande demais")
	}
	rest := []byte(s)
	n := 0
	for {
		var b *pem.Block
		b, rest = pem.Decode(rest)
		if b == nil {
			break
		}
		if b.Type != "CERTIFICATE" {
			return fmt.Errorf("bloco %q não é certificado", b.Type)
		}
		if _, err := x509.ParseCertificate(b.Bytes); err != nil {
			return fmt.Errorf("certificado ilegível: %v", err)
		}
		n++
	}
	if n == 0 || len(bytes.TrimSpace(rest)) > 0 {
		return errors.New("PEM sem certificado ou com sobra")
	}
	return nil
}

// FactoryNetwork é a rede de fábrica (pendrive OEE/net-reset e reset de fábrica): IT
// em DHCP, OT só com o endereço de serviço; MACs, hostname e endereço de serviço da
// unidade ficam.
func FactoryNetwork(cur *Network) *Network {
	return &Network{
		NetworkVersion: cur.NetworkVersion + 1,
		Origin:         "factory",
		Hostname:       cur.Hostname,
		IT:             ITNet{MAC: cur.IT.MAC, Mode: "dhcp", Addresses: []string{}, DNS: []string{}, IPv6: "disabled"},
		OT: OTNet{MAC: cur.OT.MAC, Mode: "static", Addresses: []string{}, Routes: []OTRoute{},
			ServiceAddress: cur.OT.ServiceAddress, LocalUI: true},
		NTP: NTP{Servers: []string{}, UseDHCP: true, PublicFallback: true},
	}
}

// Arquivos gerados do network.json.
type rendered struct {
	itKeyfile, otKeyfile []byte
	proxyEnv             []byte // nil = sem proxy (arquivo removido)
	chrony               []byte // nil = sem NTP do cliente (arquivo removido)
	caBundle             []byte // nil = sem CA corporativa (arquivo removido)
}

// stableUUID gera o uuid do perfil a partir do MAC e do papel, quando o keyfile
// atual não tem um: o mesmo perfil mantém a identidade no NetworkManager.
func stableUUID(role, mac string) string {
	h := sha1.Sum([]byte("oee-gateway/" + role + "/" + mac))
	h[6] = h[6]&0x0f | 0x50
	h[8] = h[8]&0x3f | 0x80
	s := hex.EncodeToString(h[:16])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
}

var uuidLineRe = regexp.MustCompile(`(?m)^uuid=([0-9a-fA-F-]{36})\s*$`)

// keyfileUUID lê o uuid de um keyfile existente ("" se não houver).
func keyfileUUID(b []byte) string {
	if m := uuidLineRe.FindSubmatch(b); m != nil {
		return strings.ToLower(string(m[1]))
	}
	return ""
}

// render gera os perfis do NetworkManager (amarrados pelo MAC, como o factory
// init), o proxy.env, as fontes do chrony e o pacote de CAs. Todo valor já passou
// pelo Validate: nenhum texto livre entra nos arquivos.
func (n *Network) render(itUUID, otUUID string) rendered {
	var r rendered
	var it strings.Builder
	it.WriteString("# Gerado pelo oee-helper a partir do network.json (rede da IT, ETH1).\n")
	fmt.Fprintf(&it, "[connection]\nid=oee-it\nuuid=%s\ntype=ethernet\nautoconnect=true\n\n", itUUID)
	fmt.Fprintf(&it, "[ethernet]\nmac-address=%s\n\n[ipv4]\n", n.IT.MAC)
	if n.IT.Mode == "static" {
		fmt.Fprintf(&it, "method=manual\naddress1=%s,%s\ndns=%s;\nignore-auto-dns=true\n",
			n.IT.Addresses[0], *n.IT.Gateway, strings.Join(n.IT.DNS, ";"))
	} else {
		it.WriteString("method=auto\n")
		if n.Hostname != "" {
			fmt.Fprintf(&it, "dhcp-hostname=%s\ndhcp-send-hostname=true\n", n.Hostname)
		}
	}
	it.WriteString("route-metric=100\n\n[ipv6]\nmethod=disabled\n")
	r.itKeyfile = []byte(it.String())

	var ot strings.Builder
	ot.WriteString("# Gerado pelo oee-helper a partir do network.json (rede da OT, ETH0).\n")
	ot.WriteString("# Endereço de serviço sempre ativo; OT sem rota padrão e sem DNS.\n")
	fmt.Fprintf(&ot, "[connection]\nid=oee-ot\nuuid=%s\ntype=ethernet\nautoconnect=true\n\n", otUUID)
	fmt.Fprintf(&ot, "[ethernet]\nmac-address=%s\n\n[ipv4]\nmethod=manual\n", n.OT.MAC)
	i := 1
	for _, a := range n.OT.Addresses {
		fmt.Fprintf(&ot, "address%d=%s\n", i, a)
		i++
	}
	fmt.Fprintf(&ot, "address%d=%s\n", i, n.OT.ServiceAddress)
	for j, rt := range n.OT.Routes {
		fmt.Fprintf(&ot, "route%d=%s,%s\n", j+1, rt.To, rt.Via)
	}
	ot.WriteString("never-default=true\nignore-auto-dns=true\nignore-auto-routes=true\ndad-timeout=3000\n\n[ipv6]\nmethod=disabled\n")
	r.otKeyfile = []byte(ot.String())

	if n.Proxy != nil {
		noProxy := append([]string{"localhost", "127.0.0.1"}, n.Proxy.NoProxy...)
		r.proxyEnv = []byte(fmt.Sprintf("# Gerado pelo oee-helper a partir do network.json.\nHTTPS_PROXY=%s\nNO_PROXY=%s\n",
			n.Proxy.URL, strings.Join(noProxy, ",")))
	}
	if len(n.NTP.Servers) > 0 {
		var c strings.Builder
		c.WriteString("# Gerado pelo oee-helper a partir do network.json.\n")
		for _, s := range n.NTP.Servers {
			fmt.Fprintf(&c, "server %s iburst\n", s)
		}
		r.chrony = []byte(c.String())
	}
	if n.CABundlePEM != nil {
		r.caBundle = []byte(*n.CABundlePEM)
	}
	return r
}
