@Controller("bookings")
export class TicketController {
  @Post("scan")
  async scanTicket() {
    return this.ticketService.scanTicket();
  }
}
