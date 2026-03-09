---
title: Cascade 核心生命周期 API E2E 验证
date: 2026-03-09
target: daemon LS v1.19.6 (port=42100)
---

# Cascade 核心生命周期 API E2E 验证结果

> 执行时间: 2026-03-09T13:12:40.051Z
> 目标: daemon LS v1.19.6 (port=42100)
> 简单会话 A: 3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6 (已删除)
> 复杂会话 B: 19028d6e-1aaf-4aa7-a5f4-dd77ee0b1fd0 (保留)

## 汇总

| # | API | Variant | Status | Notes |
|---|-----|---------|--------|-------|
| 1 | `StartCascade` | minimal | OK |  |
| 2 | `StartCascade` | full | OK |  |
| 3 | `GetAllCascadeTrajectories` | default | OK | 总数=52, 找到A=false, 找到B=false |
| 4 | `GetCascadeTrajectory` | default_verbosity | OK |  |
| 5 | `GetCascadeTrajectory` | debug_verbosity | OK | diff vs default: SAME |
| 6 | `GetCascadeTrajectorySteps` | empty | OK |  |
| 7 | `GetCascadeTrajectoryGeneratorMetadata` | empty | OK |  |
| 8 | `SendUserCascadeMessage` | simple_chat | OK |  |
| 9 | `SendUserCascadeMessage` | complex_agent | OK |  |
| 10 | `GetCascadeTrajectorySteps` | with_data | OK | steps=6 |
| 11 | `GetCascadeTrajectorySteps` | paged_offset1 | OK | steps=5 (expected 5) |
| 12 | `GetCascadeTrajectoryGeneratorMetadata` | with_data | OK | metadata_count=1 |
| 13 | `GetCascadeTrajectoryGeneratorMetadata` | without_messages | OK |  |
| 14 | `CopyTrajectory` | default | OK | newCascadeId=4505ff99-5227-4f3d-a481-1f0078879de9 |
| 15 | `CopyTrajectory` | with_details | OK |  |
| 16 | `ConvertTrajectoryToMarkdown` | default | OK | markdown_length=217 |
| 17 | `CreateTrajectoryShare` | default | OK | no url |
| 18 | `LoadTrajectory` | default | OK |  |
| 19 | `DeleteCascadeTrajectory` | delete_simple | OK |  |
| 20 | `DeleteCascadeTrajectory` | delete_copy | OK |  |
| 21 | `DeleteCascadeTrajectory` | delete_copy2 | OK |  |
| 22 | `GetAllCascadeTrajectories` | post_cleanup | OK | A deleted=true, B exists=true, total=53 |

## 详细记录

### StartCascade

#### minimal

**请求:**
```json
{}
```

**响应 (status=200):**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6"
}
```

#### full

**请求:**
```json
{
  "metadata": {
    "ideName": "antigravity",
    "apiKey": "",
    "locale": "zh",
    "ideVersion": "1.19.6",
    "extensionName": "antigravity-probe"
  },
  "experimentConfig": {}
}
```

**响应 (status=200):**
```json
{
  "cascadeId": "19028d6e-1aaf-4aa7-a5f4-dd77ee0b1fd0"
}
```

### GetAllCascadeTrajectories

#### default

**请求:**
```json
{}
```

**响应 (status=200):**
```json
{
  "trajectorySummaries": {
    "05d86a3e-1224-4598-b5f6-5d3723aee90a": {
      "summary": "Implementing URL Routing",
      "stepCount": 207,
      "lastModifiedTime": "2026-03-09T09:00:01.891222170Z",
      "trajectoryId": "8ba7efc9-6008-49d7-a610-81045ee37cf4",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-09T07:18:22.110716341Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-09T08:57:11.989447469Z",
      "lastUserInputStepIndex": 171
    },
    "0b229a6f-2e7d-4075-a09b-e5d23806d7cf": {
      "summary": "Image Color Identification",
      "stepCount": 6,
      "lastModifiedTime": "2026-03-06T08:30:39.899379106Z",
      "trajectoryId": "6851041f-fd97-42a6-ad23-e07e7a820f56",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-06T08:30:29.407922126Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-06T08:30:29.407922126Z",
      "lastUserInputStepIndex": 0
    },
    "1c3ce40a-1752-4601-af34-085827f50ca8": {
      "summary": "Document Standardization Initiative",
      "stepCount": 51,
      "lastModifiedTime": "2026-03-08T17:18:28.107048838Z",
      "trajectoryId": "13a86151-a31e-4e9c-813f-7bfaca4c1dbc",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-08T16:58:23.692304398Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-08T17:16:19.867776958Z",
      "lastUserInputStepIndex": 27
    },
    "20de2389-fa22-4de9-ae85-a2cbe8a8f1dc": {
      "summary": "Input Box Conversation Tags",
      "stepCount": 243,
      "lastModifiedTime": "2026-03-09T09:00:16.361432056Z",
      "trajectoryId": "8a2410f7-edee-4ef8-bd13-2662369a30a4",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-09T08:24:14.152902333Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-09T08:58:03.370591847Z",
      "lastUserInputStepIndex": 206
    },
    "2770e71c-29fe-4b70-b652-2173e7d6b6ab": {
      "summary": "Create a file at /tmp/antigravity-agent-test.txt with the content: \"Hello from Antigravity Agent\". Do not ask for confirmation, just do it.",
      "stepCount": 6,
      "lastModifiedTime": "2026-03-05T06:56:36.729487764Z",
      "trajectoryId": "7a195d33-faab-49de-8669-891d22026206",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-05T06:56:28.761703180Z",
      "lastUserInputTime": "2026-03-05T06:56:28.761703180Z",
      "lastUserInputStepIndex": 0
    },
    "2cddc547-d688-47ea-a788-6e0b025393cf": {
      "summary": "AI Chat Design Discus
... (truncated)
```
> 总数=52, 找到A=false, 找到B=false

### GetCascadeTrajectory

#### default_verbosity

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6"
}
```

**响应 (status=200):**
```json
{
  "trajectory": {
    "trajectoryId": "86880407-ec82-47d0-8bcd-caa71289539b",
    "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
    "trajectoryType": "CORTEX_TRAJECTORY_TYPE_CASCADE",
    "metadata": {
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "createdAt": "2026-03-09T13:12:14.683474690Z",
      "initializationStateId": "d046bca2-571e-4fc6-8849-e8c597aeb94d"
    }
  },
  "status": "CASCADE_RUN_STATUS_IDLE"
}
```

#### debug_verbosity

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "verbosity": "CLIENT_TRAJECTORY_VERBOSITY_DEBUG"
}
```

**响应 (status=200):**
```json
{
  "trajectory": {
    "trajectoryId": "86880407-ec82-47d0-8bcd-caa71289539b",
    "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
    "trajectoryType": "CORTEX_TRAJECTORY_TYPE_CASCADE",
    "metadata": {
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "createdAt": "2026-03-09T13:12:14.683474690Z",
      "initializationStateId": "d046bca2-571e-4fc6-8849-e8c597aeb94d"
    }
  },
  "status": "CASCADE_RUN_STATUS_IDLE"
}
```
> diff vs default: SAME

### GetCascadeTrajectorySteps

#### empty

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "stepOffset": 0,
  "verbosity": "PROD_UI"
}
```

**响应 (status=200):**
```json
{}
```

### GetCascadeTrajectoryGeneratorMetadata

#### empty

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "generatorMetadataOffset": 0,
  "includeMessages": true
}
```

**响应 (status=200):**
```json
{}
```

### SendUserCascadeMessage

#### simple_chat

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "items": [
    {
      "text": "请回复 ok"
    }
  ],
  "metadata": {
    "ideName": "antigravity",
    "apiKey": "",
    "locale": "zh",
    "ideVersion": "1.19.5",
    "extensionName": "antigravity"
  },
  "cascadeConfig": "(CascadeConfig object)",
  "clientType": "CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE"
}
```

**响应 (status=200):**
```json
{}
```

#### complex_agent

**请求:**
```json
{
  "cascadeId": "19028d6e-1aaf-4aa7-a5f4-dd77ee0b1fd0",
  "items": [
    {
      "text": "创建文件 /home/tiemuer/antigravity-web/tmp/probe-test-output.js\n内容为: 一个简单的 add(a, b) 函数，带 JSDoc 注释，并导出。\n文件末尾加一行注释: // Created by probe-cascade-lifecycle.js"
    }
  ],
  "metadata": {
    "ideName": "antigravity",
    "apiKey": "",
    "locale": "zh",
    "ideVersion": "1.19.5",
    "extensionName": "antigravity"
  },
  "cascadeConfig": "(CascadeConfig object)",
  "clientType": "CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE"
}
```

**响应 (status=200):**
```json
{}
```

### GetCascadeTrajectorySteps

#### with_data

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "stepOffset": 0,
  "verbosity": "DEBUG"
}
```

**响应 (status=200):**
```json
{
  "steps": [
    {
      "type": "CORTEX_STEP_TYPE_USER_INPUT",
      "status": "CORTEX_STEP_STATUS_DONE",
      "metadata": {
        "createdAt": "2026-03-09T13:12:15.314294580Z",
        "source": "CORTEX_STEP_SOURCE_USER_EXPLICIT",
        "executionId": "1ce9257d-8ab2-4987-a73d-d57e589faf07",
        "sourceTrajectoryStepInfo": {
          "trajectoryId": "86880407-ec82-47d0-8bcd-caa71289539b",
          "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6"
        },
        "internalMetadata": {
          "statusTransitions": [
            {
              "updatedStatus": "CORTEX_STEP_STATUS_DONE",
              "timestamp": "2026-03-09T13:12:15.576390905Z"
            }
          ]
        }
      },
      "userInput": {
        "items": [
          {
            "text": "请回复 ok"
          }
        ],
        "userResponse": "请回复 ok",
        "clientType": "CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE",
        "userConfig": {
          "plannerConfig": {
            "conversational": {
              "plannerMode": "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
              "agenticMode": false
            },
            "toolConfig": {
              "runCommand": {
                "autoCommandConfig": {
                  "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
                }
              },
              "notifyUser": {
                "artifactReviewMode": "ARTIFACT_REVIEW_MODE_TURBO"
              }
            },
            "requestedModel": {
              "model": "MODEL_PLACEHOLDER_M37"
            },
            "ephemeralMessagesConfig": {
              "enabled": true
            },
            "knowledgeConfig": {
              "enabled": true
            }
          },
          "conversationHistoryConfig": {
            "enabled": true
          }
        }
      }
    },
    {
      "type": "CORTEX_STEP_TYPE_CONVERSATION_HISTORY",
      "status": "CORTEX_STEP_STATUS_DONE",
      "metadata": {
        "createdAt": "2026-03-09T13:12:15.578968855Z",
        "completedAt": "2026-03-09T13:12:15.880731255Z",
        "source": "CORTEX_STEP_SOURCE_SYSTEM",
        "executionId": "1ce9257d-8ab2-4987-a73d-d57e589faf07",
        "sourceTrajectoryStepInfo": {
          "trajectoryId": "86880407-ec82-47d0-8bcd-caa71289539b",
          "stepIndex": 1,
          "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6"
        },
        "internalMetadata": {
          "statusTransitions": [
            {
              "updatedStatus": "CORTEX_STEP_STATUS_PENDING",
              "timestamp": "2026-03-09T13:12:15.578974554Z"
            },
            {
              "updatedStatus": "CORTEX_STEP_STATUS_RUNNING",
              "timestamp": "2026-03-09T13:12:15.580124586Z"
            },
            {
              "updatedStatus": "CORTEX_STEP_STATUS_DONE",
              "timestamp": "2026-03-09T13:12:15.880740104Z"
            }
          ]
        }
      },
      "conversationHistory": {
        "content": "# Conversation H
... (truncated)
```
> steps=6

#### paged_offset1

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "stepOffset": 1
}
```

**响应 (status=200):**
```json
{
  "steps": [
    {
      "type": "CORTEX_STEP_TYPE_CONVERSATION_HISTORY",
      "status": "CORTEX_STEP_STATUS_DONE",
      "metadata": {
        "createdAt": "2026-03-09T13:12:15.578968855Z",
        "completedAt": "2026-03-09T13:12:15.880731255Z",
        "source": "CORTEX_STEP_SOURCE_SYSTEM",
        "executionId": "1ce9257d-8ab2-4987-a73d-d57e589faf07",
        "sourceTrajectoryStepInfo": {
          "trajectoryId": "86880407-ec82-47d0-8bcd-caa71289539b",
          "stepIndex": 1,
          "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6"
        },
        "internalMetadata": {
          "statusTransitions": [
            {
              "updatedStatus": "CORTEX_STEP_STATUS_PENDING",
              "timestamp": "2026-03-09T13:12:15.578974554Z"
            },
            {
              "updatedStatus": "CORTEX_STEP_STATUS_RUNNING",
              "timestamp": "2026-03-09T13:12:15.580124586Z"
            },
            {
              "updatedStatus": "CORTEX_STEP_STATUS_DONE",
              "timestamp": "2026-03-09T13:12:15.880740104Z"
            }
          ]
        }
      },
      "conversationHistory": {
        "content": "# Conversation History\nHere are the conversation IDs, titles, and summaries of your most recent 20 conversations, in reverse chronological order:\n\n<conversation_summaries>\n## Conversation 986004f4-0a56-45a2-ac66-daa20e647c16: React Native vs React Projects\n- Created: 2026-03-09T09:20:30Z\n- Last modified: 2026-03-09T09:24:48Z\n\n### USER Objective:\nReact Native vs React Projects\nThe user wants to understand the key differences between developing a React Native project and a React (web) project, specifically regarding code compatibility and development paradigms. The goal is to identify what code can be reused and what needs to be rewritten, with a focus on UI components, styling, and platform-specific APIs.\n\n## Conversation a5ce3367-cbfc-4e1f-a582-2f1fd4fbec41: Analyze LS API Docs\n- Created: 2026-03-09T09:11:12Z\n- Last modified: 2026-03-09T09:20:52Z\n\n### USER Objective:\nAnalyze LS API Docs\nThe user wants to analyze the LS API documentation for the antigravityweb project to determine how many APIs have not yet been reverse-engineered.\n\n## Conversation 4671c7b7-5bb6-4761-8ca9-e06cbf6310f5: Sidebar Update Bug\n- Created: 2026-03-09T09:12:56Z\n- Last modified: 2026-03-09T09:16:33Z\n\n### USER Objective:\nSidebar Update Bug\nThe user wants to identify and resolve an issue where the sidebar and tab UI elements do not update in real-time when a new chat conversation is created. The goal is to ensure these UI components accurately reflect the latest conversation state without manual refresh.\n\n## Conversation 20de2389-fa22-4de9-ae85-a2cbe8a8f1dc: Input Box Conversation Tags\n- Created: 2026-03-09T08:24:14Z\n- Last modified: 2026-03-09T09:00:16Z\n\n### USER Objective:\nInput Box Conversation Tags\nThe user wants to add a feature to the input box that displays recent conversation tags. This includes a togg
... (truncated)
```
> steps=5 (expected 5)

### GetCascadeTrajectoryGeneratorMetadata

#### with_data

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "generatorMetadataOffset": 0,
  "includeMessages": true
}
```

**响应 (status=200):**
```json
{
  "generatorMetadata": [
    {
      "stepIndices": [
        4
      ],
      "chatModel": {
        "systemPrompt": "<identity>\nYou are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide.\n</identity>\n\n<tool_calling>\nCall tools as you normally would. The following list provides additional guidance to help you avoid errors:   - **Absolute paths only**. When using tools that accept file path arguments, ALWAYS use the absolute file path.\n</tool_calling>\n<web_application_development>\n## Technology Stack,\nYour web applications should be built using the following technologies:,\n1. **Core**: Use HTML for structure and Javascript for logic.\n2. **Styling (CSS)**: Use Vanilla CSS for maximum flexibility and control. Avoid using TailwindCSS unless the USER explicitly requests it; in this case, first confirm which TailwindCSS version to use.\n3. **Web App**: If the USER specifies that they want a more complex web app, use a framework like Next.js or Vite. Only do this if the USER explicitly requests a web app.\n4. **New Project Creation**: If you need to use a framework for a new app, use `npx` with the appropriate script, but there are some rules to follow:,\n   - Use `npx -y` to automatically install the script and its dependencies\n   - You MUST run the command with `--help` flag to see all available options first, \n   - Initialize the app in the current directory with `./` (example: `npx -y create-vite-app@latest ./`),\n   - You should run in non-interactive mode so that the user doesn't need to input anything,\n5. **Running Locally**: When running locally, use `npm run dev` or equivalent dev server. Only build the production bundle if the USER explicitly requests it or you are validating the code for correctness.\n\n# Design Aesthetics,\n1. **Use Rich Aesthetics**: The USER should be wowed at first glance by the design. Use best practices in modern web design (e.g. vibrant colors, dark modes, glassmorphism, and dynamic animations) to create a stunning first impression. Failure to do this is UNACCEPTABLE.\n2. **Prioritize Visual Excellence**: Implement designs that will WOW the user and feel extremely premium:\n\t\t- Avoid generic colors (plain red, blue, green). Use curated, harmonious color palettes (e.g., HSL tailored colors, sleek dark modes).\n   - Using modern typography (e.g., from Google Fonts like Inter, Roboto, or Outfit) instead of browser defaults.\n\t
... (truncated)
```
> metadata_count=1

#### without_messages

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "generatorMetadataOffset": 0,
  "includeMessages": false
}
```

**响应 (status=200):**
```json
{
  "generatorMetadata": [
    {
      "stepIndices": [
        4
      ],
      "chatModel": {
        "systemPrompt": "<identity>\nYou are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.\nThis information may or may not be relevant to the coding task, it is up for you to decide.\n</identity>\n\n<tool_calling>\nCall tools as you normally would. The following list provides additional guidance to help you avoid errors:   - **Absolute paths only**. When using tools that accept file path arguments, ALWAYS use the absolute file path.\n</tool_calling>\n<web_application_development>\n## Technology Stack,\nYour web applications should be built using the following technologies:,\n1. **Core**: Use HTML for structure and Javascript for logic.\n2. **Styling (CSS)**: Use Vanilla CSS for maximum flexibility and control. Avoid using TailwindCSS unless the USER explicitly requests it; in this case, first confirm which TailwindCSS version to use.\n3. **Web App**: If the USER specifies that they want a more complex web app, use a framework like Next.js or Vite. Only do this if the USER explicitly requests a web app.\n4. **New Project Creation**: If you need to use a framework for a new app, use `npx` with the appropriate script, but there are some rules to follow:,\n   - Use `npx -y` to automatically install the script and its dependencies\n   - You MUST run the command with `--help` flag to see all available options first, \n   - Initialize the app in the current directory with `./` (example: `npx -y create-vite-app@latest ./`),\n   - You should run in non-interactive mode so that the user doesn't need to input anything,\n5. **Running Locally**: When running locally, use `npm run dev` or equivalent dev server. Only build the production bundle if the USER explicitly requests it or you are validating the code for correctness.\n\n# Design Aesthetics,\n1. **Use Rich Aesthetics**: The USER should be wowed at first glance by the design. Use best practices in modern web design (e.g. vibrant colors, dark modes, glassmorphism, and dynamic animations) to create a stunning first impression. Failure to do this is UNACCEPTABLE.\n2. **Prioritize Visual Excellence**: Implement designs that will WOW the user and feel extremely premium:\n\t\t- Avoid generic colors (plain red, blue, green). Use curated, harmonious color palettes (e.g., HSL tailored colors, sleek dark modes).\n   - Using modern typography (e.g., from Google Fonts like Inter, Roboto, or Outfit) instead of browser defaults.\n\t
... (truncated)
```

### CopyTrajectory

#### default

**请求:**
```json
{
  "cascadeId": "19028d6e-1aaf-4aa7-a5f4-dd77ee0b1fd0"
}
```

**响应 (status=200):**
```json
{
  "newCascadeId": "4505ff99-5227-4f3d-a481-1f0078879de9"
}
```
> newCascadeId=4505ff99-5227-4f3d-a481-1f0078879de9

#### with_details

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6",
  "additionalDetails": "Copied by probe script for testing"
}
```

**响应 (status=200):**
```json
{
  "newCascadeId": "35910da3-8f46-4aef-bbac-a183d2269ba5"
}
```

### ConvertTrajectoryToMarkdown

#### default

**请求:**
```json
{
  "trajectory": "(Trajectory object, omitted for brevity)"
}
```

**响应 (status=200):**
```json
{
  "markdown": "# Chat Conversation\n\nNote: _This is purely the output of the chat conversation and does not contain any raw data, codebase snippets, etc. used to generate the output._\n\n### User Input\n\n请回复 ok\n\n### Planner Response\n\nok"
}
```
> markdown_length=217

### CreateTrajectoryShare

#### default

**请求:**
```json
{
  "metadata": {
    "ideName": "antigravity"
  },
  "cascadeId": "19028d6e-1aaf-4aa7-a5f4-dd77ee0b1fd0"
}
```

**响应 (status=200):**
```json
{}
```
> no url

### LoadTrajectory

#### default

**请求:**
```json
{
  "cascadeId": "4505ff99-5227-4f3d-a481-1f0078879de9"
}
```

**响应 (status=200):**
```json
{}
```

### DeleteCascadeTrajectory

#### delete_simple

**请求:**
```json
{
  "cascadeId": "3e18d26e-fd8b-4b99-b3b3-9d459df8d0f6"
}
```

**响应 (status=200):**
```json
{}
```

#### delete_copy

**请求:**
```json
{
  "cascadeId": "4505ff99-5227-4f3d-a481-1f0078879de9"
}
```

**响应 (status=200):**
```json
{}
```

#### delete_copy2

**请求:**
```json
{
  "cascadeId": "35910da3-8f46-4aef-bbac-a183d2269ba5"
}
```

**响应 (status=200):**
```json
{}
```

### GetAllCascadeTrajectories

#### post_cleanup

**请求:**
```json
{}
```

**响应 (status=200):**
```json
{
  "trajectorySummaries": {
    "05d86a3e-1224-4598-b5f6-5d3723aee90a": {
      "summary": "Implementing URL Routing",
      "stepCount": 207,
      "lastModifiedTime": "2026-03-09T09:00:01.891222170Z",
      "trajectoryId": "8ba7efc9-6008-49d7-a610-81045ee37cf4",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-09T07:18:22.110716341Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-09T08:57:11.989447469Z",
      "lastUserInputStepIndex": 171
    },
    "0b229a6f-2e7d-4075-a09b-e5d23806d7cf": {
      "summary": "Image Color Identification",
      "stepCount": 6,
      "lastModifiedTime": "2026-03-06T08:30:39.899379106Z",
      "trajectoryId": "6851041f-fd97-42a6-ad23-e07e7a820f56",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-06T08:30:29.407922126Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-06T08:30:29.407922126Z",
      "lastUserInputStepIndex": 0
    },
    "19028d6e-1aaf-4aa7-a5f4-dd77ee0b1fd0": {
      "summary": "Creating Probe Test Output File",
      "stepCount": 6,
      "lastModifiedTime": "2026-03-09T13:12:38.851751514Z",
      "trajectoryId": "1cf7a5bf-7471-4614-8223-4512e9fd2a16",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-09T13:12:21.595807664Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-09T13:12:21.595807664Z",
      "lastUserInputStepIndex": 0
    },
    "1c3ce40a-1752-4601-af34-085827f50ca8": {
      "summary": "Document Standardization Initiative",
      "stepCount": 51,
      "lastModifiedTime": "2026-03-08T17:18:28.107048838Z",
      "trajectoryId": "13a86151-a31e-4e9c-813f-7bfaca4c1dbc",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-08T16:58:23.692304398Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-08T17:16:19.867776958Z",
      "lastUserInputStepIndex": 27
    },
    "20de2389-fa22-4de9-ae85-a2cbe8a8f1dc": {
      "summary": "Input Box Conversation Tags",
      "stepCount": 243,
      "lastModifiedTime": "2026-03-09T09:00:16.361432056Z",
      "trajectoryId": "8a2410f7-edee-4ef8-bd13-2662369a30a4",
      "status": "CASCADE_RUN_STATUS_IDLE",
      "createdTime": "2026-03-09T08:24:14.152902333Z",
      "workspaces": [
        {
          "workspaceFolderAbsoluteUri": "file:///home/tiemuer",
          "repository": {}
        }
      ],
      "lastUserInputTime": "2026-03-09T08:58:03.370591847Z",
      "lastUserInputStepIndex": 206
    },
    "2770e71c-29fe-4b70-b652-2173e7d6b6ab": {
      "
... (truncated)
```
> A deleted=true, B exists=true, total=53
