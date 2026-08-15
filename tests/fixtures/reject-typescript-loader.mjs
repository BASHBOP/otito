export async function resolve(specifier, context, nextResolve) {
  if (specifier === "typescript") {
    throw new Error("lightweight command loaded the TypeScript analysis engine");
  }
  return nextResolve(specifier, context);
}
