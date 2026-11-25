package update

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
)

// DefaultKeysDir guarda as chaves públicas Ed25519 confiáveis do OTA (a atual e a
// próxima, para a troca anual), uma por arquivo *.pub com a chave em base64. Vem no
// pacote oee-gateway-updater; a privada fica só no CI (docs/rascunhos, §chaves).
const DefaultKeysDir = "/usr/share/oee-gateway-updater/keys"

// maxKeyFile e maxSigFile limitam o que se lê de arquivos de chave e assinatura.
const (
	maxKeyFile = 1 << 10
	maxSigFile = 1 << 10
)

// ErrNoKeys: sem chave confiável, nada é aceito (falha fechada).
var ErrNoKeys = errors.New("nenhuma chave pública do OTA instalada")

// ErrBadSignature: a assinatura não confere com nenhuma chave confiável.
var ErrBadSignature = errors.New("assinatura do manifesto inválida")

// ParsePublicKey lê uma chave pública (base64 de 32 bytes; linhas # ignoradas).
func ParsePublicKey(b []byte) (ed25519.PublicKey, error) {
	raw, err := decodeB64Lines(b)
	if err != nil {
		return nil, err
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("chave pública com %d bytes (esperado %d)", len(raw), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(raw), nil
}

// ParsePrivateKey lê uma chave privada (base64 da semente de 32 bytes).
func ParsePrivateKey(b []byte) (ed25519.PrivateKey, error) {
	raw, err := decodeB64Lines(b)
	if err != nil {
		return nil, err
	}
	if len(raw) != ed25519.SeedSize {
		return nil, fmt.Errorf("chave privada com %d bytes (esperado a semente de %d)", len(raw), ed25519.SeedSize)
	}
	return ed25519.NewKeyFromSeed(raw), nil
}

func decodeB64Lines(b []byte) ([]byte, error) {
	var sb strings.Builder
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		sb.WriteString(line)
	}
	raw, err := base64.StdEncoding.DecodeString(sb.String())
	if err != nil {
		return nil, errors.New("base64 inválido")
	}
	return raw, nil
}

// LoadKeys lê as chaves *.pub do diretório (em ordem de nome). Arquivo ilegível é
// erro: uma chave corrompida não pode passar despercebida.
func LoadKeys(dir string) ([]ed25519.PublicKey, error) {
	matches, err := filepath.Glob(filepath.Join(dir, "*.pub"))
	if err != nil {
		return nil, err
	}
	sort.Strings(matches)
	var keys []ed25519.PublicKey
	for _, m := range matches {
		b, err := readLimited(m, maxKeyFile)
		if err != nil {
			return nil, fmt.Errorf("chave %s: %w", filepath.Base(m), err)
		}
		k, err := ParsePublicKey(b)
		if err != nil {
			return nil, fmt.Errorf("chave %s: %w", filepath.Base(m), err)
		}
		keys = append(keys, k)
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("%w em %s", ErrNoKeys, dir)
	}
	return keys, nil
}

// SignManifest assina os bytes do manifesto (manifest.json.sig: base64 + \n).
func SignManifest(priv ed25519.PrivateKey, manifest []byte) []byte {
	sig := ed25519.Sign(priv, manifest)
	return []byte(base64.StdEncoding.EncodeToString(sig) + "\n")
}

// VerifyManifest confere a assinatura sobre os bytes exatos do manifesto.
func VerifyManifest(keys []ed25519.PublicKey, manifest, sigFile []byte) error {
	if len(keys) == 0 {
		return ErrNoKeys
	}
	sig, err := base64.StdEncoding.DecodeString(string(bytes.TrimSpace(sigFile)))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return fmt.Errorf("%w: formato", ErrBadSignature)
	}
	for _, k := range keys {
		if ed25519.Verify(k, manifest, sig) {
			return nil
		}
	}
	return ErrBadSignature
}

// readLimited lê um arquivo comum (sem seguir link simbólico) de até max bytes.
func readLimited(path string, max int64) ([]byte, error) {
	f, err := openRegular(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, fmt.Errorf("%s: grande demais (limite %d bytes)", filepath.Base(path), max)
	}
	return b, nil
}
