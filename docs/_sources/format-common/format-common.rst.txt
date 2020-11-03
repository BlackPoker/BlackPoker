==============================
通常フォーマット
==============================

この章では、共通ルールを踏まえた通常フォーマットのルールを説明します。

共通ルールでは、具体的なアクションの効果は説明していませんでした。

BlackPokerでは共通ルールとフォーマットに応じたアクションリストをあわせることで、
対戦することが出来ます。

.. uml::

    rectangle "共通ルール" as common

    frame "フォーマット" as format{
        rectangle "ライト" as light
        rectangle "スタンダード" as std
        rectangle "プロ" as pro
        rectangle "マスター" as master
    }

    common <-- light
    common <-- std
    common <-- pro
    common <-- master
    





通常


前提となるルールは、共通ルールを参照して下さい。

通常フォーマットは次の３つのフォーマットがあります。





BlackPoker

