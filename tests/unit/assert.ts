export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(
  actual: T,
  expected: T,
  message = "values are not equal",
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message}\nactual: ${actualJson}\nexpected: ${expectedJson}`,
    );
  }
}

export async function assertRejects(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(expectedMessage),
      `expected error containing ${expectedMessage}, got ${message}`,
    );
    return;
  }
  throw new Error(`expected rejection containing ${expectedMessage}`);
}
