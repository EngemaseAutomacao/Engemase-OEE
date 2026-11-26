package localui

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/argon2"
)

// PasswordFile é o hash da senha local (formato PHC do argon2id), no estado da
// página (StateDirectory=oee-localui). É o nome que o factory init usa.
const PasswordFile = "password.argon2id"

// Parâmetros do argon2id dos hashes gravados aqui: o mínimo da OWASP (19 MiB, 2
// passadas). A página roda com MemoryMax=64M; por isso hashes com mais de
// maxArgonMemKiB são recusados (o fallback do factory init com -m 16 = 64 MiB não
// caberia: ele usa "oee-gateway localui passwd --stdin" antes).
const (
	argonMemKiB    = 19 * 1024
	argonTime      = 2
	argonThreads   = 1
	argonKeyLen    = 32
	argonSaltLen   = 16
	maxArgonMemKiB = 32 * 1024
	maxArgonTime   = 10
	maxArgonPar    = 4
	// Senha: 8 a 128 caracteres depois de normalizada.
	minPasswordLen = 8
	maxPasswordLen = 128
)

// NormalizePassword é a mesma normalização do factory init (egw_normalize_password):
// sem hífens nem espaços, em maiúsculas. A senha do cartão lacrado pode ser
// digitada com ou sem os separadores e em minúsculas.
func NormalizePassword(p string) string {
	p = strings.ReplaceAll(p, "-", "")
	p = strings.ReplaceAll(p, " ", "")
	return strings.ToUpper(strings.TrimRight(p, "\r\n"))
}

// HashPassword gera o hash PHC (argon2id) da senha já normalizada.
func HashPassword(p string) (string, error) {
	if n := len(p); n < minPasswordLen || n > maxPasswordLen {
		return "", fmt.Errorf("senha deve ter de %d a %d caracteres", minPasswordLen, maxPasswordLen)
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(p), salt, argonTime, argonMemKiB, argonThreads, argonKeyLen)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemKiB, argonTime, argonThreads,
		enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

// ErrBadHash: o arquivo de hash não é um argon2id aceito.
var ErrBadHash = errors.New("hash da senha local ilegível ou com parâmetros fora do limite")

// VerifyPassword confere a senha (normalizada) contra o hash PHC, em tempo constante.
func VerifyPassword(phc, p string) (bool, error) {
	parts := strings.Split(strings.TrimSpace(phc), "$")
	// "", "argon2id", "v=19", "m=..,t=..,p=..", salt, hash
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != fmt.Sprintf("v=%d", argon2.Version) {
		return false, ErrBadHash
	}
	var m, t uint32
	var par uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &par); err != nil {
		return false, ErrBadHash
	}
	if m < 8 || m > maxArgonMemKiB || t < 1 || t > maxArgonTime || par < 1 || par > maxArgonPar {
		return false, ErrBadHash
	}
	enc := base64.RawStdEncoding
	salt, err := enc.DecodeString(parts[4])
	if err != nil || len(salt) < 8 {
		return false, ErrBadHash
	}
	want, err := enc.DecodeString(parts[5])
	if err != nil || len(want) < 16 || len(want) > 64 {
		return false, ErrBadHash
	}
	if len(p) > maxPasswordLen {
		return false, nil
	}
	got := argon2.IDKey([]byte(p), salt, t, m, par, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// WritePasswordHash grava o hash (0600) atomicamente em dir.
func WritePasswordHash(dir, phc string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+PasswordFile+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(phc + "\n"); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, PasswordFile))
}

// GeneratePassword gera uma senha local para o cartão: 16 caracteres de um
// alfabeto sem ambíguos (sem 0/O, 1/I/L), em 4 grupos com hífen.
func GeneratePassword() (string, error) {
	const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
	// Rejeição: só bytes < 248 (8 × 31), para não ter viés.
	limit := byte(256 / len(alphabet) * len(alphabet))
	var sb strings.Builder
	buf := make([]byte, 32)
	for n := 0; n < 16; {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		for _, v := range buf {
			if v >= limit || n == 16 {
				continue
			}
			if n > 0 && n%4 == 0 {
				sb.WriteByte('-')
			}
			sb.WriteByte(alphabet[int(v)%len(alphabet)])
			n++
		}
	}
	return sb.String(), nil
}
