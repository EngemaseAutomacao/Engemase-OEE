package uplink

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/contracts"
)

// O transporte que o New monta (o do agente em campo, com o proxy do ambiente)
// tipa a recusa do CONNECT: sem isso o 407 chegaria só como a frase do status, sem
// tipo, e não seria "proxy". O proxy do ambiente é lido uma vez por processo
// (http.ProxyFromEnvironment), então o teste troca só a função de proxy.
func TestNewTransportTypesConnectRefusal(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				if _, err := http.ReadRequest(bufio.NewReader(c)); err != nil {
					return
				}
				_, _ = io.WriteString(c, "HTTP/1.1 407 \r\nContent-Length: 0\r\n\r\n")
			}()
		}
	}()

	c, err := New(Options{BaseURL: "https://oee.exemplo.invalid", Token: "gw_teste"})
	if err != nil {
		t.Fatal(err)
	}
	tr, ok := c.http.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transporte %T", c.http.Transport)
	}
	proxy, _ := url.Parse("http://" + ln.Addr().String())
	tr.Proxy = http.ProxyURL(proxy)

	_, err = c.Sync(context.Background(), &contracts.SyncRequest{})
	var pr *ProxyConnectError
	if !errors.As(err, &pr) || pr.Status != http.StatusProxyAuthRequired || pr.Proxy != proxy.Host {
		t.Fatalf("erro %v, quer ProxyConnectError 407 do proxy %s", err, proxy.Host)
	}
	if got := FailureClass(err); got != ClassProxy {
		t.Errorf("classe %q, quer proxy", got)
	}
	if want := "proxy " + proxy.Host + " recusou o túnel (CONNECT): 407 Proxy Authentication Required"; pr.Error() != want {
		t.Errorf("mensagem %q, quer %q", pr.Error(), want)
	}
}

// O "malformed HTTP ..." cru só vira falha do proxy quando a requisição HTTPS foi
// mesmo por um proxy HTTP (a função de proxy do transporte, para aquela URL).
func TestProxyReplyErrorOnlyWithProxyForTheRequest(t *testing.T) {
	raw := errors.New(`malformed HTTP response "lixo"`)
	proxy, _ := url.Parse("http://usuario:senha@proxy.planta:3128")
	socks, _ := url.Parse("socks5://proxy.planta:1080")
	viaProxy := func(r *http.Request) (*url.URL, error) {
		if r.URL.Hostname() == "direto.exemplo.com.br" { // NO_PROXY
			return nil, nil
		}
		return proxy, nil
	}
	for _, c := range []struct {
		name  string
		proxy func(*http.Request) (*url.URL, error)
		url   string
		inner error
		want  bool
	}{
		{"https por proxy", viaProxy, "https://oee.exemplo.com.br/x", raw, true},
		{"sem proxy no transporte", nil, "https://oee.exemplo.com.br/x", raw, false},
		{"NO_PROXY para a URL", viaProxy, "https://direto.exemplo.com.br/x", raw, false},
		{"http (sem CONNECT)", viaProxy, "http://oee.exemplo.com.br/x", raw, false},
		{"SOCKS (sem CONNECT)", http.ProxyURL(socks), "https://oee.exemplo.com.br/x", raw, false},
		{"depois do túnel (decorado)", viaProxy, "https://oee.exemplo.com.br/x",
			fmt.Errorf("net/http: HTTP/1.x transport connection broken: %w", raw), false},
		{"outro erro sem tipo", viaProxy, "https://oee.exemplo.com.br/x", errors.New("Forbidden"), false},
	} {
		cl := &Client{http: &http.Client{Transport: &http.Transport{Proxy: c.proxy}}}
		r, _ := http.NewRequest(http.MethodPost, c.url, nil)
		in := &url.Error{Op: "Post", URL: c.url, Err: c.inner}
		got := cl.proxyReplyError(r, in)
		var pce *ProxyConnectError
		if errors.As(got, &pce) != c.want {
			t.Errorf("%s: %v, quer ProxyConnectError = %v", c.name, got, c.want)
			continue
		}
		if !c.want {
			if got != error(in) {
				t.Errorf("%s: o erro mudou: %v", c.name, got)
			}
			continue
		}
		if pce.Proxy != "proxy.planta:3128" || pce.Status != 0 || !errors.Is(got, raw) || FailureClass(got) != ClassProxy {
			t.Errorf("%s: %+v (classe %q)", c.name, *pce, FailureClass(got))
		}
		if strings.Contains(got.Error(), "senha") {
			t.Errorf("%s: a senha do proxy apareceu no erro: %v", c.name, got)
		}
	}
}
