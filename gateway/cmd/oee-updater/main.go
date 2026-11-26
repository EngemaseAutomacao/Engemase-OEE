// Command oee-updater é o atualizador root do OTA mínimo (M4b, docs/16 §3), no
// pacote oee-gateway-updater, separado do agente para sobreviver a um agente novo
// que não sobe.
//
//	oee-updater apply --request /var/lib/oee-gateway/update/request.json
//	oee-updater boot-check
//	oee-updater seed --manifest M --sig S --deb D     (bancada: registra o instalado)
//	oee-updater sign --deb D --version V --arch A --url U --key K --out DIR   (CI)
//	oee-updater keygen --out PREFIXO                  (gera PREFIXO.key e PREFIXO.pub)
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buffer"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/buildinfo"
	"github.com/engemaseautomacao/engemase-oee/gateway/internal/update"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

const usage = `uso: oee-updater <apply|boot-check|seed|sign|keygen|version> [opções]`

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	log := slog.New(slog.NewJSONHandler(stderr, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var err error
	switch args[0] {
	case "apply", "boot-check", "seed":
		err = runUpdater(ctx, args[0], args[1:], log, stderr)
	case "sign":
		err = runSign(args[1:], stdout, stderr)
	case "keygen":
		err = runKeygen(args[1:], stdout, stderr)
	case "version":
		fmt.Fprintln(stdout, buildinfo.String())
	case "-h", "--help", "help":
		fmt.Fprintln(stdout, usage)
	default:
		fmt.Fprintln(stderr, usage)
		return 2
	}
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, "oee-updater:", err)
		return 1
	}
	return 0
}

func runUpdater(ctx context.Context, cmd string, args []string, log *slog.Logger, stderr io.Writer) error {
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	request := fs.String("request", filepath.Join(update.DefaultUpdateDir, update.RequestFile), "pedido do agente (o diretório dele é o de troca)")
	stateDir := fs.String("state-dir", "", "estado do updater (padrão: $STATE_DIRECTORY ou /var/lib/oee-gateway-updater)")
	keysDir := fs.String("keys-dir", update.DefaultKeysDir, "chaves públicas Ed25519 confiáveis (*.pub)")
	bufferPath := fs.String("buffer", "/var/lib/oee-gateway/buffer.db", "buffer do agente (esquema para a regra da L25)")
	manifest := fs.String("manifest", "", "seed: manifesto do pacote instalado")
	sig := fs.String("sig", "", "seed: assinatura do manifesto")
	deb := fs.String("deb", "", "seed: .deb instalado")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *stateDir == "" {
		*stateDir = "/var/lib/oee-gateway-updater"
		if sd := os.Getenv("STATE_DIRECTORY"); sd != "" {
			*stateDir = sd
		}
	}
	u := &update.Updater{UpdateDir: filepath.Dir(*request), StateDir: *stateDir, BufferPath: *bufferPath,
		Sys: update.DebSystem{}, Log: log}
	if cmd == "boot-check" {
		// Em todo boot, antes do agente: não depende das chaves (sem atualização
		// pendente sai na hora; com ela, só enfileira o apply).
		return u.BootCheck(ctx)
	}
	keys, err := update.LoadKeys(*keysDir)
	if err != nil {
		return err
	}
	u.Keys = keys
	switch cmd {
	case "apply":
		return u.Apply(ctx)
	default:
		if *manifest == "" || *sig == "" || *deb == "" {
			return errors.New("seed precisa de --manifest, --sig e --deb")
		}
		return u.Seed(ctx, *manifest, *sig, *deb)
	}
}

// runSign gera o manifesto e a assinatura de um .deb (CI ou bancada).
func runSign(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("sign", flag.ContinueOnError)
	fs.SetOutput(stderr)
	deb := fs.String("deb", "", ".deb do agente")
	version := fs.String("version", "", "versão semver (a do pacote)")
	arch := fs.String("arch", "", "arm64 | amd64 | armhf")
	url := fs.String("url", "", "onde o agente baixa o .deb (https, ou relativo ao manifesto)")
	key := fs.String("key", "", "chave privada (base64 da semente; NUNCA no repositório)")
	out := fs.String("out", ".", "diretório de saída (<nome>.manifest.json e .sig)")
	schema := fs.Int("buffer-schema", buffer.SchemaVersion, "buffer_schema do agente (oee-gateway version --buffer-schema)")
	rollback := fs.String("allowed-rollback-to", "", "versões anteriores aceitas, separadas por vírgula")
	minImage := fs.String("min-image-version", "", "versão mínima da imagem")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *deb == "" || *version == "" || *arch == "" || *key == "" {
		return errors.New("sign precisa de --deb, --version, --arch e --key")
	}
	kb, err := os.ReadFile(*key)
	if err != nil {
		return err
	}
	priv, err := update.ParsePrivateKey(kb)
	if err != nil {
		return err
	}
	size, sum, err := fileDigest(*deb)
	if err != nil {
		return err
	}
	m := update.Manifest{Package: "oee-gateway", Version: *version, Arch: *arch, SHA256: sum, Size: size,
		MinImageVersion: *minImage, BufferSchema: schema, URL: *url}
	if *rollback != "" {
		m.AllowedRollbackTo = strings.Split(*rollback, ",")
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if _, err := update.ParseManifest(b); err != nil {
		return err
	}
	name := strings.TrimSuffix(filepath.Base(*deb), ".deb") + ".manifest.json"
	mp := filepath.Join(*out, name)
	if err := os.WriteFile(mp, b, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(mp+".sig", update.SignManifest(priv, b), 0o644); err != nil {
		return err
	}
	fmt.Fprintln(stdout, mp)
	return nil
}

func fileDigest(path string) (int64, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, "", err
	}
	defer f.Close()
	return update.Digest(f)
}

// runKeygen gera um par de chaves do OTA. A privada vai para o cofre/CI; a pública
// para deploy/gateway/keys/ (pacote oee-gateway-updater).
func runKeygen(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("keygen", flag.ContinueOnError)
	fs.SetOutput(stderr)
	out := fs.String("out", "", "prefixo dos arquivos (gera PREFIXO.key 0600 e PREFIXO.pub)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *out == "" {
		return errors.New("keygen precisa de --out")
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	kf, err := os.OpenFile(*out+".key", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(kf, base64.StdEncoding.EncodeToString(priv.Seed())); err != nil {
		kf.Close()
		return err
	}
	if err := kf.Close(); err != nil {
		return err
	}
	pubLine := "# Chave pública do OTA (Ed25519)\n" + base64.StdEncoding.EncodeToString(pub) + "\n"
	if err := os.WriteFile(*out+".pub", []byte(pubLine), 0o644); err != nil {
		return err
	}
	fmt.Fprintln(stdout, *out+".key", *out+".pub")
	return nil
}
