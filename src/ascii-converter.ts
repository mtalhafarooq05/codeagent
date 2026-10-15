import { type Message } from "./ai/provider.js";

export function convertCharToAscii(char: string): number {
    return char.charCodeAt(0);
}