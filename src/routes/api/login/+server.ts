import { json, type RequestEvent } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import * as schema from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { generateLocalToken } from '$lib/server/auth/tokens/generateLocalToken'
import { users } from '$lib/server/providers'

export async function POST({ request, cookies }: RequestEvent) {
	try {
		const { username, passphrase } = await request.json()

		if (!username || !passphrase) {
			return json(
				{ error: 'Username and passphrase are required' },
				{ status: 400 }
			)
		}

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
			return json(
				{ error: 'Invalid credentials' },
				{ status: 401 }
			)
		}

		// Validate passphrase against database
		const isValidPassphrase = await users.passphrase.validate({
			userId: user.id.toString(),
			passphrase
		})

		if (!isValidPassphrase) {
			return json(
				{ error: 'Invalid credentials' },
				{ status: 401 }
			)
		}
		
		// Create authentication token using the proper token creation flow
		const tokenResult = await users.tokens.create({
			userId: user.id.toString(),
			event: { request, cookies } as RequestEvent,
			returning: {
				token: schema.userTokens.token
			}
		})

		const token = tokenResult[0].token

		// Set HttpOnly cookie
		cookies.set('userToken', token, {
			path: '/',
			maxAge: 30 * 24 * 60 * 60, // 30 days
			sameSite: 'lax',
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production'
		})

		return json({
			success: true,
			user: {
				id: user.id,
				username: user.username,
				isAdmin: user.isAdmin || false
			}
		})
	} catch (error) {
		console.error('Login API error:', error)
		return json(
			{ error: 'Authentication failed' },
			{ status: 500 }
		)
	}
}
