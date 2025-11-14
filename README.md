# js-promise-function-colorizer extension for VSCode

Highlights JavaScript/TypeScript functions that return promises with a custom color. You can customize the color using the `promiseColorizer.color` config.

I created this because sometimes I forget to add an await in functions that return a promise. While the [require-await](https://eslint.org/docs/latest/rules/require-await) rule on ESLint is useful, sometimes we might want to make async calls without waiting for their result. This extension simply makes us more aware of which function calls are async.

Disclaimer: AI was heavily used when making this, and there are no unit tests written. Let me know if you find any problems and I will respond in n+1 business days, where n = days passed since you reported the problem.

### TODO

- add image/gif
- add icon

## Features

Automatically detects promise-returning functions and calls

- Highlights functions in JavaScript/TypeScript that return promises with a custom color
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
