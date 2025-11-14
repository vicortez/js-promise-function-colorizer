# js-promise-function-colorizer extension for VSCode

Highlights JavaScript/Typescript function that return promises with a custom color. You can customize the color using the `promiseColorizer.color` config.

- TODO
  - add image/gif
  - add icon

Disclaimer: AI was heavily used when making this, and there are no unit tests written. Let me know if you find any problems and i will respond in n+1 business days, where n = days passed since you reported the problem.

## Features

Automatically detects promise-returning functions and calls

- Highlights functions in JavaScript/Typescript that return promises with a custom color
- Works with JavaScript, TypeScript, JSX, and TSX files

## Requirements

Depends on VSCode's typescript-language-features being enabled

## Extension Settings

This extension contributes the following settings:

- `promiseColorizer.color`: The color to use for functions that return a Promise. This must be a hex color code.

Example

```json
{
  "promiseColorizer.color": "#AF69EE"
}
```

## Known Issues

- None ATM
