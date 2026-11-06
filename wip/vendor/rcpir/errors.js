export class RcPirError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
        this.name = "RcPirError";
    }
}
//# sourceMappingURL=errors.js.map