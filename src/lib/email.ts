type SendArgs = {
	from: string
	to: string
	subject: string
	html: string
}

export async function sendTransactionalEmail(
	args: SendArgs,
	resendApiKey: string | undefined
): Promise<void> {
	if (!resendApiKey) {
		console.log('[email:dev] →', args.to, '|', args.subject, '\n', args.html)
		return
	}
	const r = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${resendApiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(args),
	})
	if (!r.ok) {
		throw new Error(`Resend send failed: ${r.status} ${await r.text()}`)
	}
}
