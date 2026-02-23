import { ToolDefinition, registerTool } from "./registry.js";
import { saveUserFact, getUserFacts } from "../memory.js";

/**
 * learn_fact — Allow the bot to store persistent information about the user.
 */
export const learnFactTool: ToolDefinition = {
    name: "learn_fact",
    description: "Save a fact about the user for long-term memory (e.g., 'The user is a software engineer', 'The user's dog is named Rex'). Use this whenever the user shares personal details or preferences.",
    parameters: {
        type: "object",
        properties: {
            fact: {
                type: "string",
                description: "The complete fact to remember.",
            },
        },
        required: ["fact"],
    },
    execute: async ({ fact, chatId }) => {
        if (!chatId) return "Error: chatId is required.";
        saveUserFact(chatId as string, fact as string);
        return `✅ Fact learned: "${fact}"`;
    },
};

registerTool(learnFactTool);
