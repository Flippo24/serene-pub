import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { tokens } from "$lib/server/auth"
import { authenticate } from "$lib/server/providers/users/authenticate"
import type { Socket } from "socket.io"

export interface AuthenticatedSocket extends Socket {
	user?: {
		id: number
		username: string
		isAdmin: boolean
		// Add other user fields as needed
	}
	isAuthenticated: boolean
	io?: any // Add io property for socket server reference
}

/**
 * Authentication middleware for Socket.IO using PASETO tokens
 * Extracts userToken from client handshake and validates it
 */
export async function authMiddleware(socket: AuthenticatedSocket, next: (err?: Error) => void) {
	try {
		// Check if accounts are enabled in system settings
		const systemSettings = await db.query.systemSettings.findFirst()

		const isAccountsEnabled = systemSettings?.isAccountsEnabled ?? false

		// A) Accounts not enabled: Always grab user 1
		if (!isAccountsEnabled) {
			socket.isAuthenticated = true  // Set to true when accounts are disabled
			
			// Fetch user 1 when accounts are disabled
			const fallbackUser = await db.query.users.findFirst({
				where: eq(schema.users.id, 1),
				columns: {
					id: true,
					username: true,
					isAdmin: true
				}
			})

			if (fallbackUser) {
				socket.user = fallbackUser
				socket.join(`user_${fallbackUser.id}`)
			}
			
			console.log("Accounts disabled, using fallback user 1")
			return next()
		}

		// B) Accounts enabled: Try to authenticate, but fall back gracefully
		const token = socket.handshake.auth?.token

		if (!token) {
			console.log("No token provided, but accounts are enabled - allowing limited access")
			socket.isAuthenticated = false
			// Allow connection but without user context - handlers will need to check auth individually
			return next()
		}

		// Decrypt the PASETO token to get the payload
		const payload = await tokens.decryptLocalToken({ token })
		
		if (!payload.id) {
			console.log("Invalid token payload - allowing limited access")
			socket.isAuthenticated = false
			return next()
		}

		// Get user agent for validation (simplified for sockets)
		const userAgentString = socket.handshake.headers['user-agent'] || ''
		
		// Parse user agent manually for basic browser/os detection
		const browser = userAgentString.includes('Chrome') ? 'Chrome' : 
						userAgentString.includes('Firefox') ? 'Firefox' :
						userAgentString.includes('Safari') ? 'Safari' : 'Unknown'
		
		const os = userAgentString.includes('Windows') ? 'Windows' :
				   userAgentString.includes('Macintosh') ? 'macOS' :
				   userAgentString.includes('Linux') ? 'Linux' : 'Unknown'

		const userAgent = {
			browser: { name: browser },
			os: { name: os }
		}

		// Authenticate the user using the existing provider
		const authResult = await authenticate({
			tokenId: payload.id as string,
			token,
			userAgent,
			validate: true
		})

		if (!authResult || !authResult.user) {
			console.log("Authentication failed - allowing limited access")
			socket.isAuthenticated = false
			return next()
		}

		// Attach user to socket
		socket.user = {
			id: authResult.user.id,
			username: authResult.user.username,
			isAdmin: authResult.user.isAdmin || false
		}
		socket.isAuthenticated = true

		// Join user-specific room
		socket.join(`user_${authResult.user.id}`)

		next()
	} catch (error: any) {
		console.error("Socket authentication error:", error)
		socket.isAuthenticated = false
		
		// Allow connection to continue but without authentication
		console.log("Auth error - allowing limited access")
		return next()
	}
}

/**
 * Middleware wrapper to ensure user is authenticated before handler execution
 */
export function requireAuth<T extends AuthenticatedSocket>(
	handler: (socket: T, ...args: any[]) => Promise<any>
) {
	return async (socket: T, ...args: any[]) => {
		// Check if accounts are disabled - if so, allow all requests
		const systemSettings = await db.query.systemSettings.findFirst()
		const isAccountsEnabled = systemSettings?.isAccountsEnabled ?? false
		
		if (!isAccountsEnabled) {
			// Accounts disabled - always allow with fallback user
			if (!socket.user) {
				const fallbackUser = await db.query.users.findFirst({
					where: eq(schema.users.id, 1),
					columns: {
						id: true,
						username: true,
						isAdmin: true
					}
				})
				if (fallbackUser) {
					socket.user = fallbackUser
				}
			}
			return handler(socket, ...args)
		}

		// Accounts enabled - require authentication
		if (!socket.isAuthenticated || !socket.user) {
			throw new Error("Authentication required")
		}
		return handler(socket, ...args)
	}
}
