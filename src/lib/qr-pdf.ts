import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'

type EventForPdf = {
	name: string
	shortCode: string
	eventDate: Date | null
}

// A4 in PDF points.
const A4_W = 595.276
const A4_H = 841.89
const ORANGE = rgb(1, 0.635, 0.16) // #FFA229 — appelsin brand orange

function drawQR(
	page: ReturnType<PDFDocument['addPage']>,
	text: string,
	x: number,
	y: number,
	size: number
) {
	const matrix = QRCode.create(text, { errorCorrectionLevel: 'M' })
	const modules = matrix.modules
	const count = modules.size
	const moduleSize = size / count
	for (let row = 0; row < count; row++) {
		for (let col = 0; col < count; col++) {
			if (modules.get(row, col)) {
				page.drawRectangle({
					x: x + col * moduleSize,
					y: y + (count - 1 - row) * moduleSize,
					width: moduleSize,
					height: moduleSize,
					color: rgb(0, 0, 0),
				})
			}
		}
	}
}

export async function generateQRPdf(event: EventForPdf, baseUrl: string): Promise<Uint8Array> {
	const guestUrl = `${baseUrl}/e/${event.shortCode}`

	const pdf = await PDFDocument.create()
	pdf.setTitle(`${event.name} — QR pack`)
	pdf.setCreator('appelsin.io')

	const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
	const regular = await pdf.embedFont(StandardFonts.Helvetica)
	const mono = await pdf.embedFont(StandardFonts.Courier)

	// ─── Page 1: big sign for the venue entrance / DJ booth ──────────────────
	const sign = pdf.addPage([A4_W, A4_H])

	sign.drawText('SHARE YOUR PHOTOS', {
		x: 50,
		y: A4_H - 90,
		font: bold,
		size: 14,
		color: ORANGE,
	})

	const titleSize = event.name.length > 30 ? 28 : 36
	sign.drawText(event.name, {
		x: 50,
		y: A4_H - 130,
		font: bold,
		size: titleSize,
		maxWidth: A4_W - 100,
	})

	const qrSize = 360
	drawQR(sign, guestUrl, (A4_W - qrSize) / 2, A4_H - 200 - qrSize, qrSize)

	sign.drawText('1.  Open your camera and scan this code', {
		x: 60,
		y: 230,
		font: regular,
		size: 14,
	})
	sign.drawText('2.  Take photos — they appear on the big screen', {
		x: 60,
		y: 205,
		font: regular,
		size: 14,
	})
	sign.drawText('3.  Or type this short code into appelsin.io/e', {
		x: 60,
		y: 180,
		font: regular,
		size: 14,
	})

	sign.drawText(event.shortCode, {
		x: (A4_W - mono.widthOfTextAtSize(event.shortCode, 56)) / 2,
		y: 95,
		font: mono,
		size: 56,
		color: ORANGE,
	})

	sign.drawText('appelsin.io', {
		x: A4_W - 80,
		y: 30,
		font: regular,
		size: 9,
		color: rgb(0.5, 0.5, 0.5),
	})

	// ─── Page 2: 8 table cards (2 cols × 4 rows) to cut apart ────────────────
	const cards = pdf.addPage([A4_W, A4_H])

	const margin = 30
	const gap = 14
	const cols = 2
	const rows = 4
	const cardW = (A4_W - 2 * margin - (cols - 1) * gap) / cols
	const cardH = (A4_H - 2 * margin - (rows - 1) * gap) / rows

	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const cx = margin + c * (cardW + gap)
			const cy = A4_H - margin - (r + 1) * cardH - r * gap

			cards.drawRectangle({
				x: cx,
				y: cy,
				width: cardW,
				height: cardH,
				borderColor: rgb(0.85, 0.85, 0.85),
				borderWidth: 0.5,
				borderDashArray: [3, 3],
			})

			const cardQrSize = Math.min(cardH - 60, cardW * 0.55)
			drawQR(cards, guestUrl, cx + 18, cy + (cardH - cardQrSize) / 2, cardQrSize)

			const textX = cx + 18 + cardQrSize + 14
			cards.drawText('Share your', {
				x: textX,
				y: cy + cardH - 38,
				font: regular,
				size: 9,
				color: rgb(0.4, 0.4, 0.4),
			})
			cards.drawText('photos', {
				x: textX,
				y: cy + cardH - 60,
				font: bold,
				size: 18,
			})
			cards.drawText('Scan, or visit:', {
				x: textX,
				y: cy + cardH - 90,
				font: regular,
				size: 8,
				color: rgb(0.4, 0.4, 0.4),
			})
			cards.drawText(`appelsin.io/e`, {
				x: textX,
				y: cy + cardH - 105,
				font: regular,
				size: 10,
			})
			cards.drawText(event.shortCode, {
				x: textX,
				y: cy + 22,
				font: mono,
				size: 20,
				color: ORANGE,
			})
		}
	}

	return await pdf.save()
}
