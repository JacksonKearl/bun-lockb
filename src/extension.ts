import * as vscode from 'vscode'
import { exec } from 'child_process'
import { promisify, TextEncoder } from 'util'
import { chmod } from 'fs'

const cyrb128 = (buff: Uint8Array) => {
	let h1 = 1779033703,
		h2 = 3144134277,
		h3 = 1013904242,
		h4 = 2773480762
	for (let i = 0, k; i < buff.length; i++) {
		k = buff[i]
		h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
		h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
		h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
		h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
	}
	h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
	h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
	h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
	h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)

	return [
		(h1 ^ h2 ^ h3 ^ h4) >>> 0,
		(h2 ^ h1) >>> 0,
		(h3 ^ h1) >>> 0,
		(h4 ^ h1) >>> 0,
	].join('')
}
let dir: vscode.Uri
export async function activate(context: vscode.ExtensionContext) {
	dir = context.storageUri || context.globalStorageUri
	await vscode.workspace.fs.createDirectory(dir)

	const realifyURI = async (uri: vscode.Uri) => {
		const contents = await vscode.workspace.fs.readFile(uri)
		const contentHash =
			cyrb128(contents) + uri.fsPath.slice(uri.fsPath.lastIndexOf('.'))
		const realUri = vscode.Uri.joinPath(dir, contentHash)
		await vscode.workspace.fs.writeFile(realUri, contents)
		return {
			base: dir.fsPath,
			file: contentHash,
			uri: realUri,
		}
	}
	let diffs: Promise<vscode.Uri>[] = []

	const provider: vscode.CustomReadonlyEditorProvider<
		{ out: string } & vscode.CustomDocument
	> = {
		async openCustomDocument(uri, openContext, token) {
			let done: (d: vscode.Uri) => void

			diffs.push(new Promise<vscode.Uri>((c) => (done = c)))
			setTimeout(() => diffs.shift(), 500)

			// get an actual file to exec from git/whatever data providers
			const { base, file, uri: realUri } = await realifyURI(uri)

			await promisify(chmod)(base + '/' + file, '755')
			const data = await promisify(exec)('./' + file, {
				cwd: base,
			})

			const lockemup = (uri: vscode.Uri) =>
				uri.with({ path: uri.path + '.lock' })

			const lockUri = lockemup(realUri)
			await vscode.workspace.fs.writeFile(
				lockUri,
				new TextEncoder().encode(data.stdout),
			)

			done!(lockUri)

			if (diffs.length === 2) {
				const [lhs, rhs] = diffs
				diffs = []
				const resolved = await Promise.all([lhs, rhs])
				vscode.commands.executeCommand('vscode.diff', ...resolved)
			}

			return {
				uri,
				dispose: () => {},
				out: data.stdout,
			}
		},

		resolveCustomEditor(document, webviewPanel, token) {
			webviewPanel.webview.html = `<pre>` + document.out + `</pre>`
		},
	}

	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider('bun.lockb', provider),
		vscode.commands.registerCommand('bun.lockb.showDiff', () => {
			console.log(vscode.window.tabGroups.activeTabGroup)
		}),
	)
}

export async function deactivate() {
	if (dir)
		await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false })
}
