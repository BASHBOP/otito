import { Body, Controller, Get, Param, Post } from "@nestjs/common";

@Controller("orders")
export class OrdersController {
  @Get(":id")
  getOrder(@Param("id") id: string) {
    return { id };
  }

  @Post()
  createOrder(@Body() body: { items: string[] }) {
    return { id: "ord_1", items: body.items };
  }
}
