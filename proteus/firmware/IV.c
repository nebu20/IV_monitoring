#define F_CPU 16000000UL

#include "IV.h"

long tare_value = 0;
uint32_t cumulative_drips = 0;  /* monotonically increasing drip counter */

long calibration_value = 1;

static void lcd_send_nibble(uint8_t nibble)
{
    if (nibble & 0x10)
        PORTD |= (1 << LCD_D4);
    else
        PORTD &= ~(1 << LCD_D4);

    if (nibble & 0x20)
        PORTD |= (1 << LCD_D5);
    else
        PORTD &= ~(1 << LCD_D5);

    if (nibble & 0x40)
        PORTD |= (1 << LCD_D6);
    else
        PORTD &= ~(1 << LCD_D6);

    if (nibble & 0x80)
        PORTD |= (1 << LCD_D7);
    else
        PORTD &= ~(1 << LCD_D7);

    PORTB |= (1 << LCD_EN);
    _delay_us(1);
    PORTB &= ~(1 << LCD_EN);
    _delay_us(100);
}

static void lcd_write(uint8_t data, uint8_t is_data)
{
    if (is_data)
        PORTB |= (1 << LCD_RS);
    else
        PORTB &= ~(1 << LCD_RS);

    lcd_send_nibble(data);
    lcd_send_nibble(data << 4);

    _delay_us(100);
}

void lcd_command(uint8_t command)
{
    lcd_write(command, 0);
}

void lcd_data(uint8_t data)
{
    lcd_write(data, 1);
}

void lcd_init(void)
{
    DDRB |= (1 << LCD_RS) | (1 << LCD_EN);

    DDRD |= (1 << LCD_D4) |
            (1 << LCD_D5) |
            (1 << LCD_D6) |
            (1 << LCD_D7);

    _delay_ms(20);

    lcd_send_nibble(0x30);
    _delay_ms(5);

    lcd_send_nibble(0x30);
    _delay_us(150);

    lcd_send_nibble(0x30);
    _delay_us(150);

    lcd_send_nibble(0x20);
    _delay_us(150);

    lcd_command(0x28);
    lcd_command(0x0C);
    lcd_command(0x06);
    lcd_command(0x01);

    _delay_ms(2);
}

void lcd_print(const char *str)
{
    while (*str)
        lcd_data(*str++);
}

void lcd_set_cursor(uint8_t row, uint8_t column)
{
    uint8_t address;

    if (row == 0)
        address = column;
    else
        address = 0x40 + column;

    lcd_command(0x80 | address);
}

void lcd_print_uint(uint16_t number)
{
    char buffer[6];
    uint8_t i = 0;

    if (number == 0)
    {
        lcd_data('0');
        return;
    }

    while (number > 0)
    {
        buffer[i++] = '0' + (number % 10);
        number /= 10;
    }

    while (i > 0)
        lcd_data(buffer[--i]);
}

void hx711_init(void)
{
    DDRD &= ~(1 << HX711_DOUT);
    DDRD |= (1 << HX711_SCK);

    PORTD &= ~(1 << HX711_SCK);
}

long hx711_read(void)
{
    uint32_t data = 0;
    uint8_t i;

    while (PIND & (1 << HX711_DOUT))
    {
    }

    for (i = 0; i < 24; i++)
    {
        PORTD |= (1 << HX711_SCK);
        _delay_us(1);

        data <<= 1;

        if (PIND & (1 << HX711_DOUT))
            data |= 1;

        PORTD &= ~(1 << HX711_SCK);
        _delay_us(1);
    }

    PORTD |= (1 << HX711_SCK);
    _delay_us(1);

    PORTD &= ~(1 << HX711_SCK);
    _delay_us(1);

    if (data & 0x800000)
        data |= 0xFF000000;

    return (long)data;
}

void tare_scale(void)
{
    long sum = 0;

    lcd_command(0x01);

    lcd_set_cursor(0, 0);
    lcd_print("Taring...");

    lcd_set_cursor(1, 0);
    lcd_print("Please Wait");

    for (uint8_t i = 0; i < 100; i++)
    {
        sum += hx711_read();
        _delay_ms(10);
    }

    tare_value = sum / 100;

    _delay_ms(500);
}

void calibrate_scale(void)
{
    long sum = 0;
    long reading;

    tare_scale();

    lcd_command(0x01);

    lcd_set_cursor(0, 0);
    lcd_print("Put 100g weight");

    lcd_set_cursor(1, 0);
    lcd_print("on load cell");

    _delay_ms(3000);

    lcd_command(0x01);

    lcd_set_cursor(0, 0);
    lcd_print("Calibrating...");

    lcd_set_cursor(1, 0);
    lcd_print("Please Wait");

    for (uint8_t i = 0; i < 100; i++)
    {
        reading = hx711_read();
        sum += reading;
        _delay_ms(10);
    }

    sum /= 100;

    calibration_value = sum - tare_value;

    if (calibration_value == 0)
        calibration_value = 1;

    lcd_command(0x01);

    lcd_set_cursor(0, 0);
    lcd_print("Calibration");

    lcd_set_cursor(1, 0);
    lcd_print("Complete");

    _delay_ms(1500);

    lcd_command(0x01);
}

uint16_t get_weight(void)
{
    long reading;
    long difference;
    uint16_t weight;

    reading = hx711_read();

    difference = reading - tare_value;

    if (difference < 0)
        return 0;

    weight =
        (uint32_t)difference *
        CALIBRATION_WEIGHT /
        calibration_value;

    return weight;
}

// ============================================================
//                    UART  (9600 baud, TX only)
// ============================================================
//
// TX -> PD1 (connect to Proteus Virtual Terminal RX / COMPIM RX)
// The Python bridge reads JSON lines from this port and forwards
// them to POST /api/telemetry.
//
// Baud = 9600 @ 16 MHz -> UBRR = 103

void uart_init(void)
{
    UBRR0H = 0;
    UBRR0L = 103;                        /* 9600 @ 16 MHz */
    UCSR0B = (1 << TXEN0);               /* enable TX only */
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00); /* 8N1 */
}

static void uart_tx_char(char c)
{
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = (uint8_t)c;
}

static void uart_tx_str(const char *s)
{
    while (*s) uart_tx_char(*s++);
}

/* Transmit a decimal uint32 without printf */
static void uart_tx_uint32(uint32_t v)
{
    char buf[11];
    uint8_t i = 0;
    if (v == 0) { uart_tx_char('0'); return; }
    while (v > 0) { buf[i++] = '0' + (v % 10); v /= 10; }
    while (i > 0) uart_tx_char(buf[--i]);
}

void uart_send_telemetry(uint16_t weight_g, uint32_t drip_count)
{
    /* {"sensorId":"SENS-101","weightGrams":380,"rawDripCount":14}
 */
    uart_tx_str("{\"sensorId\":\"" SENSOR_ID "\",");
    uart_tx_str("\"weightGrams\":");
    uart_tx_uint32((uint32_t)weight_g);
    uart_tx_str(",\"rawDripCount\":");
    uart_tx_uint32(drip_count);
    uart_tx_str("}\r\n");
}


int main(void)
{
    uint16_t weight;
    uint8_t ir_flow;

    DDRB |= (1 << LED_PIN);
    PORTB &= ~(1 << LED_PIN);

    DDRB &= ~(1 << IR_PIN);
    PORTB &= ~(1 << IR_PIN);

    lcd_init();
    hx711_init();

    lcd_print("IV Monitor");

    lcd_set_cursor(1, 0);
    lcd_print("Starting...");

    _delay_ms(2000);

    calibrate_scale();
    uart_init();
    /* UART ready: bridge will read JSON from TX (PD1) */

    while (1)
    {
        weight = get_weight();

        if (PINB & (1 << IR_PIN))
            ir_flow = 1;
        else
            ir_flow = 0;

        lcd_set_cursor(0, 0);

        lcd_print("Weight: ");
        lcd_print_uint(weight);
        lcd_print(" g   ");

        lcd_set_cursor(1, 0);

        if (ir_flow == 1)
            lcd_print("Flow: OK       ");
        else
            lcd_print("Flow: BLOCKED  ");

        if ((weight < LOW_WEIGHT_GRAMS) ||
            (ir_flow == 0))
        {
            PORTB |= (1 << LED_PIN);
        }
        else
        {
            PORTB &= ~(1 << LED_PIN);
        }

        /* Send telemetry JSON to the MediGuard bridge */
        uart_send_telemetry(weight, cumulative_drips);

        _delay_ms(200);
    }
}