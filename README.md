# CLAUDEX

> **声明**
> 
> 1. 本项目基于 [https://github.com/dnakov/anon-kode](https://github.com/dnakov/anon-kode) 0.0.53 版本进一步开发。
> 
> 2. 为什么要自己做呢? fk cursor/fk cc。
> 
> 3. 本项目目标是支持 oneapi/newapi 转化出来的 openai 兼容的强大模型，能自由使用 free api~
>
> 4. 为什么要改原有项目名称为 ClaudeX？因为一些不可描述的原因，防止和谐，所以替换了名称。
>
> 5. 个人愿景：在 AI 编程时代，开发一个自己愿意天天使用，且不受商业 AI IDE 限制的软件，吃自己的 dog food。该软件由 ClaudeX 维护~

## 开始使用

安装 ClaudeX：
```
npm install -g @devhorizonlabs/claudex
```

导航到你的项目目录并运行：
```
claudex
```

https://github.com/user-attachments/assets/7a9253a7-8bb0-40d5-a3f3-5e6096d7c789


Terminal-based AI coding tool that can use any model that supports the OpenAI-style API.

- Fixes your spaghetti code
- Explains wtf that function does
- Runs tests, shell commands and stuff
- Whatever else claude-code can do, depending on the model you use

## HOW TO USE

```
npm install -g anon-kode
cd your-project
kode
```

You can use the onboarding to set up the model, or `/model`.
If you don't see the models you want on the list, you can manually set them in `/config`
As long as you have an openai-like endpoint, it should work.

## USE AS MCP SERVER

Find the full path to `kode` with `which kode` then add the config to Claude Desktop:
```
{
  "mcpServers": {
    "claude-code": {
      "command": "/path/to/kode",
      "args": ["mcp", "serve"]
    }
  }
}
```

## HOW TO DEV

```
pnpm i
pnpm run dev
pnpm run build
```

Get some more logs while debugging:
```
NODE_ENV=development pnpm run dev --verbose --debug
```

## BUGS

You can submit a bug from within the app with `/bug`, it will open a browser to github issue create with stuff filed out.

## Warning

Use at own risk.


## YOUR DATA

- There's no telemetry or backend servers other than the AI providers you choose
