import { db } from "$lib/server/db"

/**
 * Gets user's active configurations with fallback to system defaults
 */
export async function getUserConfigurations(userId: number) {
	// Get user settings
	const userSettings = await db.query.userSettings.findFirst({
		where: (us, { eq }) => eq(us.userId, userId)
	})

	// Get system settings for fallback values
	const systemSettings = await db.query.systemSettings.findFirst()

	// Resolve active configurations with fallback to system defaults
	let activeConnection: SelectConnection | undefined
	let activeSamplingConfig: SelectSamplingConfig | undefined
	let activeContextConfig: SelectContextConfig | undefined
	let activePromptConfig: SelectPromptConfig | undefined

	// Get active connection (userSettings -> systemSettings fallback)
	const activeConnectionId =
		userSettings?.activeConnectionId ?? systemSettings?.defaultConnectionId
	if (activeConnectionId) {
		activeConnection = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, activeConnectionId)
		})
	}

	// Get active sampling config (userSettings -> systemSettings fallback)
	const activeSamplingConfigId =
		userSettings?.activeSamplingConfigId ??
		systemSettings?.defaultSamplingConfigId
	if (activeSamplingConfigId) {
		activeSamplingConfig = await db.query.samplingConfigs.findFirst({
			where: (sc, { eq }) => eq(sc.id, activeSamplingConfigId)
		})
	}

	// Get active context config (userSettings -> systemSettings fallback)
	const activeContextConfigId =
		userSettings?.activeContextConfigId ??
		systemSettings?.defaultContextConfigId
	if (activeContextConfigId) {
		activeContextConfig = await db.query.contextConfigs.findFirst({
			where: (cc, { eq }) => eq(cc.id, activeContextConfigId)
		})
	}

	// Get active prompt config (userSettings -> systemSettings fallback)
	const activePromptConfigId =
		userSettings?.activePromptConfigId ??
		systemSettings?.defaultPromptConfigId
	if (activePromptConfigId) {
		activePromptConfig = await db.query.promptConfigs.findFirst({
			where: (pc, { eq }) => eq(pc.id, activePromptConfigId)
		})
	}

	// Ensure we have all required configurations
	if (
		!activeConnection ||
		!activeSamplingConfig ||
		!activeContextConfig ||
		!activePromptConfig
	) {
		throw new Error(
			`Missing required configuration for user ${userId}: ${!activeConnection ? "connection " : ""}${!activeSamplingConfig ? "sampling " : ""}${!activeContextConfig ? "context " : ""}${!activePromptConfig ? "prompt" : ""}`
		)
	}

	return {
		connection: activeConnection,
		sampling: activeSamplingConfig,
		contextConfig: activeContextConfig,
		promptConfig: activePromptConfig
	}
}
