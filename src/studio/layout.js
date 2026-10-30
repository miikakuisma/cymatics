// The one definition of "phone": narrow screens, and phones held sideways.
export const PHONE_QUERY = '(max-width: 768px), (pointer: coarse) and (max-height: 500px)'

let query
export function phoneQuery() {
	return (query ??= window.matchMedia(PHONE_QUERY))
}
