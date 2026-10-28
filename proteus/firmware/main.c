/* =====================================================================
 * MEDICINE REMINDER  -  Bare-metal AVR-GCC code (no Arduino libraries)
 * MCU      : ATmega328P @ 16 MHz external crystal
 * RTC      : DS3234 (SPI)
 * Display  : 16x2 character LCD (HD44780), 4-bit mode
 * Inputs   : 3 push buttons (SET, UP, DOWN)  -- ACTIVE LOW
 *            (button press connects the pin to GND; internal pull-ups
 *             enabled in software hold the pin HIGH when not pressed)
 * Outputs  : LED (blinks on alarm), Buzzer (sounds on alarm)
 *
 * ---------------------------------------------------------------------
 * PIN MAP  (change ONLY this block if your schematic differs)
 * ---------------------------------------------------------------------
 *  RTC (SPI, hardware peripheral):
 *      CS   -> PB2 (SS)
 *      MOSI -> PB3
 *      MISO -> PB4
 *      SCK  -> PB5
 *
 *  LED    -> PB0
 *  BUZZER -> PB1
 *
 *  LCD (4-bit mode):
 *      RS -> PC0
 *      EN -> PC1
 *      D4 -> PC2
 *      D5 -> PC3
 *      D6 -> PC4
 *      D7 -> PC5
 *      (RW tied to GND on the LCD, or wire it and it will still work
 *       because we only ever write)
 *
 *  BUTTONS (ACTIVE LOW -- pressed = pin reads LOW, internal pull-ups used):
 *      SET  -> PD2
 *      UP   -> PD3
 *      DOWN -> PD4
 * =====================================================================
 */

#define F_CPU 16000000UL
#include <avr/io.h>
#include <util/delay.h>
#include <stdio.h>

/* ---------------- PIN MAP DEFINITIONS ---------------- */
#define LED_PORT   PORTB
#define LED_DDR    DDRB
#define LED_PIN    PB0

#define BUZ_PORT   PORTB
#define BUZ_DDR    DDRB
#define BUZ_PIN    PB1

#define RTC_CS_PORT  PORTB
#define RTC_CS_DDR   DDRB
#define RTC_CS_PIN   PB2

#define LCD_PORT   PORTC
#define LCD_DDR    DDRC
#define LCD_RS     PC0
#define LCD_EN     PC1
#define LCD_D4     PC2
#define LCD_D5     PC3
#define LCD_D6     PC4
#define LCD_D7     PC5

#define BTN_PORT   PORTD
#define BTN_DDR    DDRD
#define BTN_PIN    PIND
#define BTN_SET    PD2
#define BTN_UP     PD3
#define BTN_DOWN   PD4

/* ================= SPI ================= */
static void SPI_init(void)
{
    /* MOSI, SCK, CS as output; MISO input */
    DDRB |= (1 << PB3) | (1 << PB5) | (1 << RTC_CS_PIN);
    DDRB &= ~(1 << PB4);

    RTC_CS_PORT |= (1 << RTC_CS_PIN);   /* CS idle HIGH */

    /* Enable SPI, Master mode, clock = Fosc/16 (fine for DS3234, max 4MHz) */
    SPCR = (1 << SPE) | (1 << MSTR) | (1 << SPR0);
}

static uint8_t SPI_transfer(uint8_t data)
{
    SPDR = data;
    while (!(SPSR & (1 << SPIF)));
    return SPDR;
}

/* ================= DS3234 RTC ================= */
#define DS3234_SEC   0x00
#define DS3234_MIN   0x01
#define DS3234_HOUR  0x02

static void RTC_writeReg(uint8_t reg, uint8_t val)
{
    RTC_CS_PORT &= ~(1 << RTC_CS_PIN);      /* CS low */
    SPI_transfer(reg | 0x80);               /* MSB=1 -> write */
    SPI_transfer(val);
    RTC_CS_PORT |= (1 << RTC_CS_PIN);       /* CS high */
}

static uint8_t RTC_readReg(uint8_t reg)
{
    uint8_t val;
    RTC_CS_PORT &= ~(1 << RTC_CS_PIN);
    SPI_transfer(reg & 0x7F);               /* MSB=0 -> read */
    val = SPI_transfer(0x00);
    RTC_CS_PORT |= (1 << RTC_CS_PIN);
    return val;
}

static uint8_t bcd2bin(uint8_t v) { return (v & 0x0F) + ((v >> 4) * 10); }
static uint8_t bin2bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }

static void RTC_getTime(uint8_t *h, uint8_t *m, uint8_t *s)
{
    *s = bcd2bin(RTC_readReg(DS3234_SEC));
    *m = bcd2bin(RTC_readReg(DS3234_MIN));
    uint8_t hraw = RTC_readReg(DS3234_HOUR) & 0x3F;   /* mask 24h bit */
    *h = bcd2bin(hraw);
}

static void RTC_setTime(uint8_t h, uint8_t m, uint8_t s)
{
    RTC_writeReg(DS3234_SEC,  bin2bcd(s));
    RTC_writeReg(DS3234_MIN,  bin2bcd(m));
    RTC_writeReg(DS3234_HOUR, bin2bcd(h));   /* 24-hour mode (bit6=0) */
}

/* ================= LCD (4-bit mode) ================= */
static void lcd_pulseEnable(void)
{
    LCD_PORT |= (1 << LCD_EN);
    _delay_us(1);
    LCD_PORT &= ~(1 << LCD_EN);
    _delay_us(100);
}

static void lcd_send4(uint8_t nibble)
{
    LCD_PORT = (LCD_PORT & 0x03) |
               ((nibble & 0x01) ? (1 << LCD_D4) : 0) |
               ((nibble & 0x02) ? (1 << LCD_D5) : 0) |
               ((nibble & 0x04) ? (1 << LCD_D6) : 0) |
               ((nibble & 0x08) ? (1 << LCD_D7) : 0) |
               (LCD_PORT & ((1 << LCD_RS) | (1 << LCD_EN)));
    lcd_pulseEnable();
}

static void lcd_write(uint8_t value, uint8_t isData)
{
    if (isData) LCD_PORT |= (1 << LCD_RS);
    else        LCD_PORT &= ~(1 << LCD_RS);

    lcd_send4(value >> 4);
    lcd_send4(value & 0x0F);
    _delay_us(50);
}

static void lcd_command(uint8_t cmd) { lcd_write(cmd, 0); }
static void lcd_data(uint8_t data)   { lcd_write(data, 1); }

static void lcd_string(const char *str)
{
    while (*str) lcd_data(*str++);
}

static void lcd_setCursor(uint8_t row, uint8_t col)
{
    uint8_t addr = (row == 0) ? (0x80 + col) : (0xC0 + col);
    lcd_command(addr);
}

static void lcd_init(void)
{
    LCD_DDR |= (1 << LCD_RS) | (1 << LCD_EN) |
               (1 << LCD_D4) | (1 << LCD_D5) | (1 << LCD_D6) | (1 << LCD_D7);
    _delay_ms(40);

    /* Force 4-bit mode per HD44780 init sequence */
    LCD_PORT &= ~(1 << LCD_RS);
    lcd_send4(0x03); _delay_ms(5);
    lcd_send4(0x03); _delay_us(150);
    lcd_send4(0x03);
    lcd_send4(0x02);               /* now in 4-bit mode */

    lcd_command(0x28);  /* 4-bit, 2 line, 5x8 font */
    lcd_command(0x0C);  /* display ON, cursor off */
    lcd_command(0x06);  /* increment cursor */
    lcd_command(0x01);  /* clear display */
    _delay_ms(2);
}

/* ================= Buttons (ACTIVE HIGH) ================= */
static void buttons_init(void)
{
    /* Inputs with internal pull-ups enabled. Buttons connect the pin
     * to GND when pressed (active-LOW), matching the corrected
     * schematic wiring (button common terminals wired directly to GND). */
    BTN_DDR &= ~((1 << BTN_SET) | (1 << BTN_UP) | (1 << BTN_DOWN));
    BTN_PORT |= (1 << BTN_SET) | (1 << BTN_UP) | (1 << BTN_DOWN);
}

static uint8_t btn_pressed(uint8_t pin)
{
    if (!(BTN_PIN & (1 << pin))) {          /* pressed = LOW */
        _delay_ms(30);                      /* debounce */
        if (!(BTN_PIN & (1 << pin))) {
            while (!(BTN_PIN & (1 << pin))); /* wait for release (goes HIGH) */
            return 1;
        }
    }
    return 0;
}

/* ================= Alarm / Outputs ================= */
static void outputs_init(void)
{
    LED_DDR |= (1 << LED_PIN);
    BUZ_DDR |= (1 << BUZ_PIN);
    LED_PORT &= ~(1 << LED_PIN);
    BUZ_PORT &= ~(1 << BUZ_PIN);
}

static void alarm_trigger(uint8_t ah, uint8_t am)
{
    lcd_command(0x01); /* clear */
    lcd_setCursor(0, 0);
    lcd_string("TAKE MEDICINE!");

    uart_send_med_event("ALARM_FIRED", ah, am);
    while (1) {
        LED_PORT ^= (1 << LED_PIN);
        BUZ_PORT ^= (1 << BUZ_PIN);
        _delay_ms(300);

        /* any button press dismisses the alarm */
        if (btn_pressed(BTN_SET) || btn_pressed(BTN_UP) || btn_pressed(BTN_DOWN)) {
            LED_PORT &= ~(1 << LED_PIN);
            BUZ_PORT  &= ~(1 << BUZ_PIN);
            lcd_command(0x01);
            uart_send_med_event("ALARM_DISMISSED", ah, am);
            break;
        }
    }
}

/* ================= Alarm set menu ================= */
static void set_alarm(uint8_t *ah, uint8_t *am)
{
    /* --- set hour --- */
    lcd_command(0x01);
    lcd_setCursor(0, 0);
    lcd_string("Set Alarm Hour");
    while (1) {
        char buf[6];
        lcd_setCursor(1, 0);
        sprintf(buf, "%02d", *ah);
        lcd_string(buf);
        lcd_string("    ");

        if (btn_pressed(BTN_UP))   *ah = (*ah + 1) % 24;
        if (btn_pressed(BTN_DOWN)) *ah = (*ah == 0) ? 23 : *ah - 1;
        if (btn_pressed(BTN_SET))  break;
    }

    /* --- set minute --- */
    lcd_command(0x01);
    lcd_setCursor(0, 0);
    lcd_string("Set Alarm Min");
    while (1) {
        char buf[6];
        lcd_setCursor(1, 0);
        sprintf(buf, "%02d", *am);
        lcd_string(buf);
        lcd_string("    ");

        if (btn_pressed(BTN_UP))   *am = (*am + 1) % 60;
        if (btn_pressed(BTN_DOWN)) *am = (*am == 0) ? 59 : *am - 1;
        if (btn_pressed(BTN_SET))  break;
    }

    lcd_command(0x01);
    lcd_setCursor(0, 0);
    lcd_string("Alarm Saved!");
    _delay_ms(1000);
    lcd_command(0x01);
}

/* ================= MAIN ================= */
/* ================================================================
 * UART output for MediGuard medicine reminder bridge
 * TX -> PD1 (connect to Proteus Virtual Terminal RX)
 * Baud: 9600 at 16 MHz
 *
 * Events emitted as JSON lines:
 *   {"event":"ALARM_FIRED","hour":8,"minute":0}\r\n
 *   {"event":"ALARM_DISMISSED","hour":8,"minute":0}\r\n
 * ================================================================ */
#define UBRR0H  (*(volatile uint8_t*)0xC5)
#define UBRR0L  (*(volatile uint8_t*)0xC4)
#define UCSR0A  (*(volatile uint8_t*)0xC0)
#define UCSR0B  (*(volatile uint8_t*)0xC1)
#define UCSR0C  (*(volatile uint8_t*)0xC2)
#define UDR0    (*(volatile uint8_t*)0xC6)
#define TXEN0   3
#define UCSZ00  1
#define UCSZ01  2
#define UDRE0   5

static void uart_init_med(void)
{
    UBRR0H = 0;
    UBRR0L = 103;
    UCSR0B = (1 << TXEN0);
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
}

static void uart_tx(char c)
{
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = (uint8_t)c;
}

static void uart_puts(const char *s)
{
    while (*s) uart_tx(*s++);
}

static void uart_tx_u8(uint8_t v)
{
    char buf[4]; uint8_t i = 0;
    if (v == 0) { uart_tx('0'); return; }
    while (v > 0) { buf[i++] = '0' + (v % 10); v /= 10; }
    while (i > 0) uart_tx(buf[--i]);
}

static void uart_send_med_event(const char *event, uint8_t h, uint8_t m)
{
    uart_puts("{\"event\":\"");
    uart_puts(event);
    uart_puts("\",\"hour\":");
    uart_tx_u8(h);
    uart_puts(",\"minute\":");
    uart_tx_u8(m);
    uart_puts("}\r\n");
}

int main(void)
{
    uint8_t h, m, s;
    uint8_t alarmHour = 8, alarmMin = 0;   /* default alarm 08:00 */
    uint8_t lastSec = 0xFF;
    uint8_t alarmFiredThisMinute = 0;

    outputs_init();
    buttons_init();
    SPI_init();
    lcd_init();
    uart_init_med();

    /* Uncomment ONCE to set the RTC clock, then re-comment and reflash:
       RTC_setTime(14, 30, 0);   // 14:30:00
    */

    lcd_setCursor(0, 0);
    lcd_string("Medicine Timer");
    _delay_ms(1500);
    lcd_command(0x01);

    while (1) {

        /* Enter alarm-set menu */
        if (btn_pressed(BTN_SET)) {
            set_alarm(&alarmHour, &alarmMin);
        }

        /* ---- TEST TRIGGER ----
         * Hold DOWN alone for ~2 seconds to fire the alarm immediately,
         * bypassing the RTC time comparison. Use this to confirm the
         * LED / buzzer wiring and alarm_trigger() logic work correctly
         * before worrying about RTC timing at all.
         * (Single-button long-press, so it's easy to do with just a
         * mouse click-and-hold in Proteus.)
         * Remove this block once you've verified everything works.
         */
        if (!(BTN_PIN & (1 << BTN_DOWN))) {        /* pressed = LOW */
            uint16_t heldMs = 0;
            while (!(BTN_PIN & (1 << BTN_DOWN)) && heldMs < 2000) {
                _delay_ms(10);
                heldMs += 10;
            }
            if (heldMs >= 2000) {
                alarm_trigger(alarmHour, alarmMin);
                while (!(BTN_PIN & (1 << BTN_DOWN)));  /* wait for release (HIGH) */
            }
        }

        RTC_getTime(&h, &m, &s);

        if (s != lastSec) {           /* refresh display once per second */
            lastSec = s;
            char line1[17], line2[17];

            sprintf(line1, "Time  %02d:%02d:%02d", h, m, s);
            sprintf(line2, "Alarm %02d:%02d", alarmHour, alarmMin);

            lcd_setCursor(0, 0);
            lcd_string(line1);
            lcd_setCursor(1, 0);
            lcd_string(line2);

            /* trigger once per matching minute (at second 0) */
            if (h == alarmHour && m == alarmMin) {
                if (!alarmFiredThisMinute) {
                    alarm_trigger(alarmHour, alarmMin);
                    alarmFiredThisMinute = 1;
                }
            } else {
                alarmFiredThisMinute = 0;
            }
        }
    }
}
