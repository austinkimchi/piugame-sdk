export class PiuError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class AuthenticationError extends PiuError {
  public constructor(message = "Authentication failed.", options?: { cause?: unknown }) {
    super("AUTHENTICATION_FAILED", message, options);
  }
}

export class SessionExpiredError extends PiuError {
  public constructor(message = "Session expired and automatic reauthentication failed.", options?: { cause?: unknown }) {
    super("SESSION_EXPIRED", message, options);
  }
}

export class SSORequiredError extends PiuError {
  public readonly redirectUrl: string;

  public constructor(redirectUrl: string) {
    super("SSO_REQUIRED", `SSO is required before PIUGAME data can be accessed. Redirect: ${redirectUrl}`);
    this.redirectUrl = redirectUrl;
  }
}

export class SSOAutomationError extends PiuError {
  public constructor(message = "Automatic SSO resolution failed.", options?: { cause?: unknown }) {
    super("SSO_AUTOMATION_FAILED", message, options);
  }
}

export class ParseError extends PiuError {
  public readonly parser: string;

  public constructor(parser: string, message: string, options?: { cause?: unknown }) {
    super("PARSE_ERROR", message, options);
    this.parser = parser;
  }
}

export class NetworkError extends PiuError {
  public readonly status: number;

  public constructor(status: number, message: string, options?: { cause?: unknown }) {
    super("NETWORK_ERROR", message, options);
    this.status = status;
  }
}

export class TitleUpdateError extends PiuError {
  public constructor(message = "Unable to update title.", options?: { cause?: unknown }) {
    super("TITLE_UPDATE_FAILED", message, options);
  }
}
