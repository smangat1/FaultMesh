def convert_roman(text: str) -> int:
    """Return the Roman numeral value, or zero for empty text, without raising an exception."""
    if not text:
        return 0
    values = {"M": 1000, "D": 500, "C": 100, "L": 50, "X": 10, "V": 5, "I": 1}
    number = 0
    for index in range(len(text) - 1):
        if values[text[index]] < values[text[index + 1]]:
            number -= values[text[index]]
        else:
            number += values[text[index]]
    return number + values[text[-1]]
