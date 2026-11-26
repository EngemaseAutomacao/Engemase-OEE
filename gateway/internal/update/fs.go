package update

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// openRegular abre só arquivo comum, sem seguir link simbólico no último
// componente. O updater (root) lê arquivos de /var/lib/oee-gateway/update, que é
// do usuário oee: um link para /etc/shadow ou um FIFO não podem passar.
func openRegular(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|oNoFollow|oNonBlock, 0)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if !st.Mode().IsRegular() {
		f.Close()
		return nil, fmt.Errorf("%s não é arquivo comum", filepath.Base(path))
	}
	return f, nil
}

// copyVerified copia src (arquivo comum, sem seguir link) para dst, no máximo max
// bytes, e devolve o tamanho e o SHA-256 do que foi copiado. É a cópia que vale:
// conferir o original e instalar a cópia fecha a troca do arquivo entre os dois.
func copyVerified(src, dst string, max int64) (int64, string, error) {
	in, err := openRegular(src)
	if err != nil {
		return 0, "", err
	}
	defer in.Close()
	return copyFrom(in, dst, max)
}

// copyFrom copia de in para dst (novo, 0600), no máximo max bytes.
func copyFrom(in io.Reader, dst string, max int64) (int64, string, error) {
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC|oNoFollow, 0o600)
	if err != nil {
		return 0, "", err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), io.LimitReader(in, max+1))
	if err == nil && n > max {
		err = fmt.Errorf("%s: maior que o limite (%d bytes)", filepath.Base(dst), max)
	}
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(dst)
		return 0, "", err
	}
	return n, hex.EncodeToString(h.Sum(nil)), nil
}

// fileSHA256 calcula o SHA-256 e o tamanho de um arquivo comum.
func fileSHA256(path string) (int64, string, error) {
	f, err := openRegular(path)
	if err != nil {
		return 0, "", err
	}
	defer f.Close()
	return Digest(f)
}

// Digest devolve o tamanho e o SHA-256 (hex) do que r tiver.
func Digest(r io.Reader) (int64, string, error) {
	h := sha256.New()
	n, err := io.Copy(h, r)
	if err != nil {
		return 0, "", err
	}
	return n, hex.EncodeToString(h.Sum(nil)), nil
}

// writeAtomic grava num temporário exclusivo (O_EXCL: não segue link plantado),
// fsync e rename. Num diretório de outro usuário, o rename troca só a entrada.
func writeAtomic(path string, b []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
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
	if err := os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	return syncDir(dir)
}

func writeJSON(path string, v any, mode os.FileMode) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, append(b, '\n'), mode)
}

// readJSON lê JSON de um arquivo comum limitado; ausente devolve os.ErrNotExist.
func readJSON(path string, max int64, v any) error {
	b, err := readLimited(path, max)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s ilegível: %w", filepath.Base(path), err)
	}
	return nil
}

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	if err := d.Sync(); err != nil && !errors.Is(err, os.ErrInvalid) {
		return err
	}
	return nil
}
