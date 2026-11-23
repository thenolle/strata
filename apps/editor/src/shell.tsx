/** @jsxImportSource @gambrel/view */
import type { Child } from '@gambrel/view'

export function Shell(): Child {
	return (
		<html lang="en" class="dark">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Strata</title>
				<link rel="stylesheet" href="/assets/components.css" />
				<link rel="stylesheet" href="/assets/editor.css" />
			</head>
			<body>
				<div id="app">
					<noscript>Strata needs JavaScript.</noscript>
				</div>
				<script type="module" src="/assets/client.js"></script>
			</body>
		</html>
	)
}
