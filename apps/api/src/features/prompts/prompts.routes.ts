import { Router } from 'express';
import { createModelCaller, improvePrompt, improveSkill, writeInstructions } from '@app/agent';
import {
  improvePromptSchema,
  instructionsDraftSchema,
  skillImproveSchema,
  type ImprovedPrompt,
  type ImprovedSkill,
  type InstructionsDraft,
} from '@app/shared';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { ValidationError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import type { ModelsService } from '../models/models.service.js';
import { peekProject } from './project-peek.js';

/**
 * Prompt helpers, answered by the chosen model; nothing is saved:
 * POST /v1/prompts/improve rewrites a message draft, POST /v1/prompts/instructions writes a
 * workspace's instructions (the form fills its box with the result), POST /v1/prompts/skill
 * writes or rewrites a skill's instructions from a request and suggests its description (the
 * skill form's AI writer).
 */
export function promptsRouter({ store }: AppContext, models: ModelsService): Router {
  const router = Router();

  router.post(
    '/prompts/improve',
    asyncHandler(async (req, res) => {
      const { text, modelId, reasoningEffort, workspaceId } = parse(improvePromptSchema, req.body);
      const { settings } = await models.forRun(modelId, reasoningEffort);
      const workspace = workspaceId ? await store.getWorkspace(workspaceId) : null;
      const improved = await improvePrompt(createModelCaller(settings), text, {
        workspace: workspace?.name,
        instructions: workspace?.instructions,
      });
      if (!improved)
        throw new ValidationError("The model didn't return an improved prompt. Try again.");
      const data: ImprovedPrompt = { text: improved };
      res.json({ data });
    }),
  );

  router.post(
    '/prompts/instructions',
    asyncHandler(async (req, res) => {
      const { request, current, name, path, modelId } = parse(instructionsDraftSchema, req.body);
      const { settings } = await models.forRun(modelId, undefined);
      const text = await writeInstructions(createModelCaller(settings), {
        request,
        current,
        workspace: name,
        folder: path,
        project: await peekProject(path),
      });
      if (!text) throw new ValidationError("The model didn't return any instructions. Try again.");
      const data: InstructionsDraft = { text };
      res.json({ data });
    }),
  );

  router.post(
    '/prompts/skill',
    asyncHandler(async (req, res) => {
      const { request, name, description, body, modelId } = parse(skillImproveSchema, req.body);
      const { settings } = await models.forRun(modelId, undefined);
      const improved = await improveSkill(createModelCaller(settings), {
        request,
        name,
        description,
        body,
      });
      if (!improved) {
        throw new ValidationError("The model didn't return any instructions. Try again.");
      }
      const data: ImprovedSkill = improved;
      res.json({ data });
    }),
  );

  return router;
}
