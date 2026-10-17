package com.helio.infrastructure.persistence

import slick.jdbc.SetParameter

import java.sql.Types

/** Binds a `Seq[String]` as a Postgres `text[]` plain-SQL parameter (`= ANY($ids)`, or an argument to a function taking
 *  `text[]`). Slick's plain-SQL interpolation has no built-in array parameter. */
private[persistence] object SqlTextArrays {

  implicit val setTextArray: SetParameter[Seq[String]] = SetParameter { (v, pp) =>
    pp.setObject(pp.ps.getConnection.createArrayOf("text", v.toArray[AnyRef]), Types.ARRAY)
  }
}
