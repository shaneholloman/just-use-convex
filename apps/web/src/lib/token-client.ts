export class TokenClient {
  private token: string | null = null;

  constructor() {
    this.token = null;
  }

  public setToken(token: string) {
    this.token = token;
  }

  public getToken() {
    return this.token;
  }
}