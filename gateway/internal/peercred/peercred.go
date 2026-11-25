// Package peercred identifica quem está do outro lado de um socket Unix pelo
// SO_PEERCRED (uid, gid e pid que o kernel registrou no connect). É a checagem de
// chamador do oee-helper (root ou grupo oee) e da API local do agente para a página
// local (grupo oee-ui).
package peercred

// Peer é quem chamou.
type Peer struct {
	PID  int32
	UID  uint32
	GID  uint32
	Root bool
}
