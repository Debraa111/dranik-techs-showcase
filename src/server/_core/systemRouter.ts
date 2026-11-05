import { z } from "zod";
import { protectedProcedure, router } from "./trpc";
import { notifyOwner } from "./notification";

export const systemRouter = router({
  notifyOwner: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255), content: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      const success = await notifyOwner(input);
      return { success };
    }),
});
