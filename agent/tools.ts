import { Type, type Context, type Tool } from "@earendil-works/pi-ai";


export function runTool(toolName: string, args: Record<string, any>):string {
    // 处理一下文件路径，确保是绝对路径
    const isAbsolute = args.path.startsWith('/')
    const targetPath = isAbsolute ? args.path : process.cwd() + '/' + args.path

    switch (toolName) {
        case 'list_file':
            return "main.txt"
        case 'read_file':
            return "这是文件内容"
        default:
            throw new Error('Unknown tool: ' + toolName)
    }
}

export const listFileTool: Tool = {
    name: 'list_file',
    description: 'list files in a directory',
    parameters: Type.Object({
        path: Type.String()
    })
}

export const readFileTool: Tool = {
    name: 'read_file',
    description: 'read a file',
    parameters: Type.Object({
        path: Type.String()
    })
}
