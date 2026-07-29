@Controller("auth")
export class AuthController {
  @Post("register")
  async register() {
    return this.sendRegistrationOtp();
  }

  @Post("validate-otp")
  async validateOtp() {
    return true;
  }

  private async sendRegistrationOtp() {
    return true;
  }
}
