#ifndef IV_H
#define IV_H

typedef unsigned char uint8_t;
typedef unsigned short uint16_t;
typedef unsigned long uint32_t;

#define PINB    (*(volatile uint8_t *)0x23)
#define DDRB    (*(volatile uint8_t *)0x24)
#define PORTB   (*(volatile uint8_t *)0x25)

#define PIND    (*(volatile uint8_t *)0x29)
#define DDRD    (*(volatile uint8_t *)0x2A)
#define PORTD   (*(volatile uint8_t *)0x2B)

#define PB0     0
#define PB1     1
#define PB2     2
#define PB3     3
#define PB4     4
#define PB5     5

#define PD0     0
#define PD1     1
#define PD2     2
#define PD3     3
#define PD4     4
#define PD5     5
#define PD6     6
#define PD7     7

#define LCD_RS      PB4
#define LCD_EN      PB3

#define LCD_D4      PD5
#define LCD_D5      PD4
#define LCD_D6      PD3
#define LCD_D7      PD2

#define LED_PIN     PB0
#define IR_PIN      PB2

#define HX711_DOUT  PD6
#define HX711_SCK   PD7

#define LOW_WEIGHT_GRAMS    100
#define CALIBRATION_WEIGHT  100

extern long tare_value;
extern long calibration_value;

void lcd_init(void);
void lcd_command(uint8_t command);
void lcd_data(uint8_t data);
void lcd_print(const char *str);
void lcd_set_cursor(uint8_t row, uint8_t column);
void lcd_print_uint(uint16_t number);

void hx711_init(void);
long hx711_read(void);

void tare_scale(void);
void calibrate_scale(void);
uint16_t get_weight(void);

/* ── UART (for JSON telemetry output to MediGuard bridge) ─────────────────
 * Baud: 9600 at 16 MHz → UBRR = 103
 * TX: PD1 (connect to Proteus Virtual Terminal RX)
 *
 * JSON format (one line per sample, CR+LF):
 *   {"sensorId":"SENS-101","weightGrams":380,"rawDripCount":14}\r\n
 *
 * The Python bridge (proteus/bridge/serial_bridge.py) reads these,
 * adds a Unix timestamp, and POSTs to POST /api/telemetry.
 * Change SENSOR_ID to match the IV line registered in MediGuard.
 */

/* AVR UART registers */
#define UBRR0H  (*(volatile uint8_t *)0xC5)
#define UBRR0L  (*(volatile uint8_t *)0xC4)
#define UCSR0A  (*(volatile uint8_t *)0xC0)
#define UCSR0B  (*(volatile uint8_t *)0xC1)
#define UCSR0C  (*(volatile uint8_t *)0xC2)
#define UDR0    (*(volatile uint8_t *)0xC6)

#define TXEN0   3
#define UCSZ00  1
#define UCSZ01  2
#define UDRE0   5

#define SENSOR_ID "SENS-101"

void uart_init(void);
void uart_send_telemetry(uint16_t weight_g, uint32_t drip_count);

#endif