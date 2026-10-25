from buggy_python_project import bounded_increment


def test_increments_an_ordinary_value() -> None:
    assert bounded_increment(2, 5) == 3


def test_caps_an_already_out_of_range_value() -> None:
    assert bounded_increment(8, 5) == 5

