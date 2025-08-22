import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import * as schema from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { users } from '$lib/server/providers'

export async function POST({ request }) {
	try {
		const { newPassphrase } = await request.json()
		
		if (!newPassphrase) {
			return json({ error: 'New passphrase is required' }, { status: 400 })
		}

		// Find admin user
		const adminUser = await db.query.users.findFirst({
			where: eq(schema.users.username, 'admin'),
			columns: { id: true, username: true }
		})

		if (!adminUser) {
			return json({ error: 'Admin user not found' }, { status: 404 })
		}

		// Set the new passphrase
		await users.passphrase.set({
			userId: adminUser.id.toString(),
			passphrase: newPassphrase
		})

		return json({ success: true, message: 'Admin passphrase updated' })
	} catch (error) {
		console.error('Reset passphrase error:', error)
		return json({ error: 'Failed to reset passphrase' }, { status: 500 })
	}
}
