//go:build !linux

package update

import (
	"os"
	"path/filepath"
)

const (
	oNoFollow = 0
	oNonBlock = 0
)

// lockFile: o updater só roda no Linux; fora dele (desenvolvimento) não trava.
func lockFile(string) (func(), error) { return func() {}, nil }

// xferDir fora do Linux usa caminhos (sem a proteção do openat; só desenvolvimento).
type xferDir struct{ path string }

func openXfer(path string) (*xferDir, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	return &xferDir{path: path}, nil
}

func (d *xferDir) Close() error { return nil }
func (d *xferDir) open(name string) (*os.File, error) {
	return openRegular(filepath.Join(d.path, name))
}
func (d *xferDir) remove(name string) error {
	if err := os.Remove(filepath.Join(d.path, name)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
func (d *xferDir) writeAtomic(name string, b []byte, mode os.FileMode) error {
	return writeAtomic(filepath.Join(d.path, name), b, mode)
}
