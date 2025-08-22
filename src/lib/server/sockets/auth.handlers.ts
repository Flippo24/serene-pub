import type { AuthenticatedSocket } from "$lib/server/sockets/auth"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { generateLocalToken } from "$lib/server/auth/tokens/generateLocalToken"

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
		// Find user by username
		const user = await db.query.users.findFirst({
			where: eq(schema.users.username, username),
			columns: {
				id: true,
				username: true,
				isAdmin: true
			}
		})

		if (!user) {
			socket.emit("auth:login:error", { error: "Invalid credentials" })
			return
		}

		// TODO: Add passphrase verification here
		// For now, we'll accept any passphrase for development purposes
		if (!passphrase) {
			socket.emit("auth:login:error", { error: "Passphrase is required" })
			return
		}

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
		socket.emit("auth:login:error", { error: "Authentication failed" })
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
