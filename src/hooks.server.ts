import { dev } from "$app/environment"
import { loadSocketsServer } from "$lib/server/sockets/loadSockets.server"
import { appVersion } from "$lib/shared/constants/version"
import type { Handle } from "@sveltejs/kit"
// import { userAuthentication, routeGuard } from "$server/middleware"

const middleware: Middleware[] = [] // [userAuthentication, routeGuard]

loadSocketsServer()
declare module "@sveltejs/kit" {
	interface Locals {
		latestRelease?: string
		isNewerReleaseAvailable?: boolean
	}
}

const GITHUB_API_URL =
	"https://api.github.com/repos/doolijb/serene-pub/releases/latest"

/**
 * Compare two semver strings (e.g., v0.2.0-alpha)
 * Returns 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
	const stripV = (s: string) => s.replace(/^v/, "")
	const parse = (s: string) =>
		stripV(s).split(/[-+]/)[0].split(".").map(Number)
	const [aMajor, aMinor, aPatch] = parse(a)
	const [bMajor, bMinor, bPatch] = parse(b)
	if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
	if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
	if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
	return 0
}

async function checkForUpdates() {
	try {
		console.log("[VersionCheck] Checking for new release...")
		const res = await fetch(GITHUB_API_URL, {
			headers: { Accept: "application/vnd.github+json" }
		})
		if (res.ok) {
			const data = await res.json()
			const latestTag = data.tag_name
			console.log(
				`[VersionCheck] Current: ${appVersion}, Latest: ${latestTag}`
			)
			if (
				typeof latestTag === "string" &&
				typeof appVersion === "string"
			) {
				const isNewer = compareVersions(latestTag, appVersion) === 1
				latestReleaseTag = latestTag
				isNewerReleaseAvailable = isNewer
				if (isNewer) {
					console.log(
						`[VersionCheck] Newer release available: ${latestTag}`
					)
				} else {
					console.log("[VersionCheck] No newer release available.")
				}
			}
		} else {
			console.warn(
				`[VersionCheck] Failed to fetch latest release: HTTP ${res.status}`
			)
		}
	} catch (err) {
		console.error("[VersionCheck] Error checking for new release:", err)
	}
}

let latestReleaseTag: string | undefined = undefined
let isNewerReleaseAvailable: boolean | undefined = undefined
let hasCheckedForUpdates = false

export const handle: Handle = async ({ event, resolve }) => {
	if (
		event.url.pathname.startsWith(
			"/.well-known/appspecific/com.chrome.devtools"
		)
	) {
		return new Response(null, { status: 204 }) // Return empty response with 204 No Content
	}

	if (!dev && !hasCheckedForUpdates) {
		hasCheckedForUpdates = true
		await checkForUpdates()
	}
	event.locals.latestReleaseTag = latestReleaseTag
	event.locals.isNewerReleaseAvailable = isNewerReleaseAvailable

	for (const handler of middleware) {
		await handler(event)
	}

	return resolve(event)
}
