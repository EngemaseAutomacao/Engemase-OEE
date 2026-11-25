package update

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

const (
	oNoFollow = syscall.O_NOFOLLOW
	oNonBlock = syscall.O_NONBLOCK // um FIFO plantado não trava o open
)

// lockFile pega a trava exclusiva do updater (apply e boot-check nunca juntos).
func lockFile(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}

// xferDir é o diretório de troca com o agente (/var/lib/oee-gateway/update), que
// é do usuário oee: o root só mexe nele por um descritor aberto sem seguir link
// simbólico, e cada arquivo é aberto, apagado ou criado relativo a esse descritor
// (openat/unlinkat/renameat), também sem seguir link. Um "update" trocado por um
// link para /etc não leva o root a ler, apagar ou criar nada fora dele.
type xferDir struct{ f *os.File }

func openXfer(path string) (*xferDir, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	return &xferDir{f: f}, nil
}

func (d *xferDir) Close() error { return d.f.Close() }

// open abre um arquivo comum do diretório (sem seguir link; FIFO não trava).
func (d *xferDir) open(name string) (*os.File, error) {
	fd, err := unix.Openat(int(d.f.Fd()), name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, &os.PathError{Op: "openat", Path: name, Err: err}
	}
	f := os.NewFile(uintptr(fd), name)
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if !st.Mode().IsRegular() {
		f.Close()
		return nil, fmt.Errorf("%s não é arquivo comum", name)
	}
	return f, nil
}

func (d *xferDir) remove(name string) error {
	if err := unix.Unlinkat(int(d.f.Fd()), name, 0); err != nil && err != unix.ENOENT {
		return &os.PathError{Op: "unlinkat", Path: name, Err: err}
	}
	return nil
}

// writeAtomic cria um temporário exclusivo no diretório e o renomeia para name.
func (d *xferDir) writeAtomic(name string, b []byte, mode os.FileMode) error {
	rnd := make([]byte, 6)
	if _, err := rand.Read(rnd); err != nil {
		return err
	}
	tmp := "." + name + "." + hex.EncodeToString(rnd)
	dfd := int(d.f.Fd())
	fd, err := unix.Openat(dfd, tmp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, uint32(mode.Perm()))
	if err != nil {
		return &os.PathError{Op: "openat", Path: tmp, Err: err}
	}
	f := os.NewFile(uintptr(fd), tmp)
	_, err = f.Write(b)
	if err == nil {
		err = f.Chmod(mode)
	}
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = unix.Renameat(dfd, tmp, dfd, name)
	}
	if err != nil {
		_ = unix.Unlinkat(dfd, tmp, 0)
		return err
	}
	return d.f.Sync()
}
