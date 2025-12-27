import { dev } from "$app/environment"
import axios from "axios"
import * as skio from "sveltekit-io"

export async function loadSocketsClient({ domain }: { domain: string }) {
	const res = await axios.get("/api/sockets-endpoint")
	const serverUrl = new URL(res.data.endpoint)
	const host = dev ? serverUrl.origin : window.location.origin
	console.log("Connecting to socket server at:", host)

	const io = await skio.setup(host, {
		cors: { origin: "*", credentials: false },
		maxHttpBufferSize: 1e8
	})

	if (typeof io.to !== "function") {
		io.to = () => ({ emit: () => {} })
	}
}
