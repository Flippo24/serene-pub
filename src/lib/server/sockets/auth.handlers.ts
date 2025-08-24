import type { AuthenticatedSocket } from "$lib/server/sockets/auth"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { generateLocalToken } from "$lib/server/auth/tokens/generateLocalToken"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"

/**
 * Handle user login authentication
 * For now, this is a simplified version that just finds the user by username
 * TODO: Add proper passphrase authentication
 */
async function handleLogin(
	socket: AuthenticatedSocket,
	{ username, passphrase }: { username: string; passphrase: string }
) {
	try {
		// Get client IP for rate limiting
		const clientIP = socket.handshake.address || socket.conn.remoteAddress || 'unknown'
		
		// Check rate limiting first
		if (loginRateLimit.isRateLimited(clientIP)) {
			const timeUntilReset = loginRateLimit.getTimeUntilReset(clientIP)
			socket.emit("auth:login:error", { 
				error: "Too many failed attempts",
				description: `Please wait ${timeUntilReset} seconds before trying again`,
				rateLimited: true,
				timeUntilReset
			})
			return
		}

		// Find user by username
		const user = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.username, username),
			columns: {
				id: true,
				username: true,
				isAdmin: true
			}
		})

		if (!user) {
			// Record failed attempt
			loginRateLimit.recordFailedAttempt(clientIP)
			const remaining = loginRateLimit.getRemainingAttempts(clientIP)
			
			socket.emit("auth:login:error", { 
				error: "Invalid credentials",
				remainingAttempts: remaining
			})
			return
		}

		// TODO: Add passphrase verification here
		// For now, we'll accept any passphrase for development purposes
		if (!passphrase) {
			// Record failed attempt
			loginRateLimit.recordFailedAttempt(clientIP)
			const remaining = loginRateLimit.getRemainingAttempts(clientIP)
			
			socket.emit("auth:login:error", { 
				error: "Passphrase is required",
				remainingAttempts: remaining
			})
			return
		}

		// Clear rate limit on successful login
		loginRateLimit.clearRateLimit(clientIP)

		// Create a new authentication token
		const token = await generateLocalToken({
			payload: {
				id: user.id.toString(),
				userId: user.id,
				username: user.username,
				isAdmin: user.isAdmin || false
			}
		})

		// Update socket with authenticated user
		socket.user = {
			id: user.id,
			username: user.username,
			isAdmin: user.isAdmin || false
		}
		socket.isAuthenticated = true
		socket.join(`user_${user.id}`)

		// Send success response
		socket.emit("auth:login:success", {
			user: socket.user,
			token // Client will need to store this in a cookie
		})

	} catch (error) {
		console.error("Login error:", error)
		
		// Record failed attempt for server errors too
		const clientIP = socket.handshake.address || socket.conn.remoteAddress || 'unknown'
		loginRateLimit.recordFailedAttempt(clientIP)
		const remaining = loginRateLimit.getRemainingAttempts(clientIP)
		
		socket.emit("auth:login:error", { 
			error: "Authentication failed",
			remainingAttempts: remaining
		})
	}
}

/**
 * Handle user logout
 */
async function handleLogout(socket: AuthenticatedSocket) {
	try {
		if (socket.user) {
			socket.leave(`user_${socket.user.id}`)
		}
		
		socket.user = undefined
		socket.isAuthenticated = false

		socket.emit("auth:logout:success", {})
	} catch (error) {
		console.error("Logout error:", error)
		socket.emit("auth:logout:error", { error: "Logout failed" })
	}
}

/**
 * Register auth-related socket handlers
 */
export function registerAuthHandlers(
	socket: AuthenticatedSocket,
	emitToUser: (event: string, data: any) => void,
	register: (socket: AuthenticatedSocket, handler: any, emitToUser: any) => void
) {
	// Direct socket event handlers (not using the register pattern for auth)
	socket.on("auth:login", async (params) => {
		await handleLogin(socket, params)
	})

	socket.on("auth:logout", async () => {
		await handleLogout(socket)
	})
}
