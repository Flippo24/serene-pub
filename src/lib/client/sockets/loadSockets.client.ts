import { dev } from "$app/environment"
import axios, { type AxiosResponse } from "axios"
import * as skio from "sveltekit-io"

interface SocketsEndpointResponse {
	endpoint: string
}

interface SocketOptions {
	cors: { origin: string; credentials: boolean }
	maxHttpBufferSize: number
}

export async function loadSocketsClient({ domain }: { domain: string }): Promise<void> {
	try {
		const res: AxiosResponse<SocketsEndpointResponse> = await axios.get("/api/sockets-endpoint")
		const serverUrl = new URL(res.data.endpoint)
		const host = `${serverUrl.protocol}//${domain}:${serverUrl.port}`
		
		if (dev) {
			console.log("Connecting to socket server at:", host)
		}

		const socketOptions: SocketOptions = {
			cors: { origin: "*", credentials: false },
			maxHttpBufferSize: 1e8
		}

		const io = await skio.setup(host, socketOptions)

		// Type guard to ensure io.to function exists
		// @ts-ignore
		if (typeof io.to !== "function") {
			// @ts-ignore
			io.to = () => ({ emit: () => {} })
		}

		if (dev) {
			console.log("Socket client connected successfully")
		}
	} catch (error) {
		console.error("Failed to load socket client:", error)
		throw error
	}
}

// Re-export typed socket utilities for convenience
export { createTypedSocket, useTypedSocket, type TypedSocket } from "./typedSocket"
