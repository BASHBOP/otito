import { Body, Controller, Param, Post } from "@nestjs/common";

@Controller("events")
export class EventsController {
  @Post(":id/rsvp")
  submitRsvp(@Param("id") eventId: string, @Body() body: { attending: boolean }) {
    return { eventId, attending: body.attending };
  }
}
