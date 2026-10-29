// What the play button does in the studio. The hosted studio starts on the
// host's source (Music), so "what played last" cannot decide it: stopped with
// more than one source on offer, it opens the menu.
export function playButtonAction({ playing, offered = [] }) {
	if (playing) return 'stop'
	if (offered.length === 1 && offered[0] === 'music') return 'external'
	return 'menu'
}
